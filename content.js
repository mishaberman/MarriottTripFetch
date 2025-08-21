// Content script for extracting Marriott reservation details
(function() {
    'use strict';

    let extractionInProgress = false;

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'startExtraction') {
            if (!extractionInProgress) {
                startReservationExtraction();
            }
            sendResponse({ success: true });
        }
    });

    async function startReservationExtraction() {
        extractionInProgress = true;
        
        try {
            sendProgress(10, 'Checking login status...');
            
            // Check if user is logged in
            if (!isLoggedIn()) {
                throw new Error('Please log in to your Marriott account first.');
            }

            sendProgress(20, 'Navigating to reservations...');
            
            // Navigate to reservations page if not already there
            await navigateToReservations();
            
            sendProgress(40, 'Scanning for upcoming reservations...');
            
            // Wait for page to load and scan for reservations
            await waitForElement('.reservation, .trip-card, [data-testid*="reservation"]', 10000);
            
            sendProgress(60, 'Extracting reservation details...');
            
            // Extract reservation data
            const reservations = await extractReservationData();
            
            sendProgress(90, 'Saving extracted data...');
            
            // Store reservations
            await storeReservations(reservations);
            
            sendProgress(100, 'Extraction complete!');
            
            // Send completion message
            chrome.runtime.sendMessage({
                action: 'extractionComplete',
                data: reservations
            });

        } catch (error) {
            console.error('Extraction error:', error);
            chrome.runtime.sendMessage({
                action: 'extractionError',
                error: error.message
            });
        } finally {
            extractionInProgress = false;
        }
    }

    function isLoggedIn() {
        // Check for various indicators that user is logged in
        const loginIndicators = [
            '[data-testid="account-menu"]',
            '.account-menu',
            '.user-profile',
            '.my-account',
            '[aria-label*="Account"]',
            '.sign-out',
            '.logout'
        ];

        return loginIndicators.some(selector => document.querySelector(selector));
    }

    async function navigateToReservations() {
        const currentUrl = window.location.href;
        
        // If not on reservations page, try to navigate there
        if (!currentUrl.includes('reservation') && !currentUrl.includes('trip')) {
            // Look for reservations/trips link
            const reservationLinks = [
                'a[href*="reservation"]',
                'a[href*="trip"]',
                'a[href*="booking"]',
                'a:contains("Reservations")',
                'a:contains("My Trips")',
                'a:contains("Bookings")'
            ];

            for (const selector of reservationLinks) {
                const link = document.querySelector(selector);
                if (link) {
                    link.click();
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    break;
                }
            }
        }

        // Wait for navigation to complete
        await waitForPageLoad();
    }

    async function extractReservationData() {
        const reservations = [];
        
        // Try multiple selectors for reservation containers
        const reservationSelectors = [
            '.reservation-card',
            '.trip-card',
            '.booking-card',
            '[data-testid*="reservation"]',
            '[data-testid*="trip"]',
            '.upcoming-stay',
            '.future-reservation'
        ];

        let reservationElements = [];
        for (const selector of reservationSelectors) {
            reservationElements = document.querySelectorAll(selector);
            if (reservationElements.length > 0) break;
        }

        // If no reservation cards found, look for individual reservation data
        if (reservationElements.length === 0) {
            reservationElements = await findReservationElements();
        }

        for (let i = 0; i < reservationElements.length; i++) {
            const element = reservationElements[i];
            
            try {
                // Extract reservation details from each element
                const reservation = await extractSingleReservation(element);
                
                if (reservation && reservation.hotelName) {
                    // Filter out past reservations (only upcoming ones)
                    if (isUpcomingReservation(reservation)) {
                        reservations.push(reservation);
                    }
                }
            } catch (error) {
                console.warn('Failed to extract reservation:', error);
            }
        }

        return reservations;
    }

    async function findReservationElements() {
        const elements = [];
        
        // Look for patterns that might indicate reservation sections
        const possibleContainers = document.querySelectorAll(
            'div[class*="reservation"], div[class*="trip"], div[class*="booking"], ' +
            'div[id*="reservation"], div[id*="trip"], div[id*="booking"], ' +
            '.card, .panel, .module, .section'
        );

        for (const container of possibleContainers) {
            const text = container.textContent.toLowerCase();
            if (text.includes('hotel') || text.includes('check') || text.includes('night') || 
                text.includes('reservation') || text.includes('confirmation')) {
                elements.push(container);
            }
        }

        return elements;
    }

    async function extractSingleReservation(element) {
        const reservation = {
            extractedAt: new Date().toISOString(),
            source: window.location.href
        };

        // Extract hotel name
        reservation.hotelName = extractText(element, [
            '.hotel-name',
            '.property-name',
            'h1, h2, h3, h4',
            '[data-testid*="hotel"]',
            '[data-testid*="property"]'
        ]) || extractHotelNameFromText(element);

        // Extract confirmation number
        reservation.confirmationNumber = extractText(element, [
            '.confirmation-number',
            '.confirmation',
            '[data-testid*="confirmation"]',
            '[data-testid*="number"]'
        ]) || extractConfirmationFromText(element);

        // Extract dates
        const dates = extractDates(element);
        reservation.checkInDate = dates.checkIn;
        reservation.checkOutDate = dates.checkOut;

        // Calculate nights
        if (dates.checkIn && dates.checkOut) {
            const checkIn = new Date(dates.checkIn);
            const checkOut = new Date(dates.checkOut);
            const timeDiff = checkOut - checkIn;
            reservation.nights = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
        }

        // Extract costs
        const costs = extractCosts(element);
        reservation.totalCost = costs.total;
        reservation.pricePerNight = costs.perNight;

        // Extract points
        reservation.pointsUsed = extractPoints(element);

        // Extract promo code
        reservation.promoCode = extractPromoCode(element);

        // Extract room type
        reservation.roomType = extractText(element, [
            '.room-type',
            '.room-name',
            '[data-testid*="room"]'
        ]);

        return reservation;
    }

    function extractText(element, selectors) {
        for (const selector of selectors) {
            const el = element.querySelector(selector);
            if (el && el.textContent.trim()) {
                return el.textContent.trim();
            }
        }
        return null;
    }

    function extractHotelNameFromText(element) {
        const text = element.textContent;
        // Look for patterns that might be hotel names
        const patterns = [
            /Hotel\s+([^,\n]+)/i,
            /([^,\n]+)\s+Hotel/i,
            /Marriott\s+([^,\n]+)/i,
            /([^,\n]+)\s+Marriott/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1] || match[0];
            }
        }
        return null;
    }

    function extractConfirmationFromText(element) {
        const text = element.textContent;
        // Look for confirmation number patterns
        const patterns = [
            /Confirmation[:\s]+([A-Z0-9]+)/i,
            /Reference[:\s]+([A-Z0-9]+)/i,
            /[#]?\s*([A-Z0-9]{6,})/
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                return match[1];
            }
        }
        return null;
    }

    function extractDates(element) {
        const dates = { checkIn: null, checkOut: null };
        const text = element.textContent;

        // Look for date selectors
        const checkInSelectors = [
            '.check-in-date', '.checkin-date', '[data-testid*="checkin"]', '[data-testid*="check-in"]'
        ];
        const checkOutSelectors = [
            '.check-out-date', '.checkout-date', '[data-testid*="checkout"]', '[data-testid*="check-out"]'
        ];

        dates.checkIn = extractText(element, checkInSelectors);
        dates.checkOut = extractText(element, checkOutSelectors);

        // If not found, try to parse from text
        if (!dates.checkIn || !dates.checkOut) {
            const datePattern = /(\w{3}\s+\d{1,2},?\s+\d{4})/g;
            const dateMatches = text.match(datePattern);
            
            if (dateMatches && dateMatches.length >= 2) {
                dates.checkIn = dateMatches[0];
                dates.checkOut = dateMatches[1];
            }
        }

        // Convert to ISO format if possible
        if (dates.checkIn) dates.checkIn = parseDate(dates.checkIn);
        if (dates.checkOut) dates.checkOut = parseDate(dates.checkOut);

        return dates;
    }

    function extractCosts(element) {
        const costs = { total: null, perNight: null };
        const text = element.textContent;

        // Look for cost selectors
        const totalSelectors = [
            '.total-cost', '.total-price', '.grand-total', '[data-testid*="total"]'
        ];
        const perNightSelectors = [
            '.per-night', '.nightly-rate', '[data-testid*="night"]'
        ];

        costs.total = extractText(element, totalSelectors);
        costs.perNight = extractText(element, perNightSelectors);

        // Extract from text if not found
        if (!costs.total) {
            const totalPattern = /Total[:\s]*\$?([0-9,]+\.?\d*)/i;
            const match = text.match(totalPattern);
            if (match) costs.total = '$' + match[1];
        }

        if (!costs.perNight) {
            const perNightPattern = /\$?([0-9,]+\.?\d*)\s*per night/i;
            const match = text.match(perNightPattern);
            if (match) costs.perNight = '$' + match[1];
        }

        return costs;
    }

    function extractPoints(element) {
        const text = element.textContent;
        const patterns = [
            /(\d+,?\d*)\s*points/i,
            /points[:\s]*(\d+,?\d*)/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1].replace(',', '');
            }
        }
        return null;
    }

    function extractPromoCode(element) {
        const text = element.textContent;
        const patterns = [
            /Promo[:\s]*([A-Z0-9]+)/i,
            /Code[:\s]*([A-Z0-9]+)/i,
            /Promotion[:\s]*([A-Z0-9]+)/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1];
            }
        }
        return null;
    }

    function parseDate(dateString) {
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) {
                return dateString; // Return original if can't parse
            }
            return date.toISOString().split('T')[0]; // Return YYYY-MM-DD format
        } catch (error) {
            return dateString;
        }
    }

    function isUpcomingReservation(reservation) {
        if (!reservation.checkInDate) return true; // Include if we can't determine
        
        try {
            const checkInDate = new Date(reservation.checkInDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            return checkInDate >= today;
        } catch (error) {
            return true; // Include if we can't determine
        }
    }

    function storeReservations(reservations) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ reservations }, resolve);
        });
    }

    function sendProgress(percent, text) {
        chrome.runtime.sendMessage({
            action: 'progress',
            percent: percent,
            text: text
        });
    }

    function waitForElement(selector, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }

            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    observer.disconnect();
                    resolve(element);
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                reject(new Error('Element not found: ' + selector));
            }, timeout);
        });
    }

    function waitForPageLoad() {
        return new Promise((resolve) => {
            if (document.readyState === 'complete') {
                setTimeout(resolve, 1000);
            } else {
                window.addEventListener('load', () => {
                    setTimeout(resolve, 1000);
                });
            }
        });
    }

})();
