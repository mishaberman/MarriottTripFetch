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
            
            console.log('🚀 Starting reservation extraction...');
            console.log('📍 Current URL:', window.location.href);
            console.log('🌐 Domain:', window.location.hostname);
            
            // Check if user is logged in
            const loginStatus = isLoggedIn();
            console.log('🔑 Login status result:', loginStatus);
            
            if (!loginStatus) {
                console.log('❌ Login check failed - throwing error');
                throw new Error('Please log in to your Marriott account first. Check browser console for debugging details.');
            }
            
            console.log('✅ Login check passed - continuing extraction');

            sendProgress(20, 'Navigating to reservations...');
            
            // Navigate to reservations page if not already there
            await navigateToReservations();
            
            sendProgress(40, 'Scanning for upcoming reservations...');
            
            // Debug: Check what's actually on the page
            sendDebug('info', `Page title: ${document.title}`);
            sendDebug('info', `Page URL: ${window.location.href}`);
            
            sendProgress(60, 'Extracting reservation details...');
            
            // Extract reservation data using found elements
            const foundElements = await findAndAnalyzeReservations();
            const reservations = await extractReservationDataFromElements(foundElements);
            
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
            '.logout',
            '[data-testid*="account"]',
            '[data-testid*="profile"]',
            '[data-testid*="user"]',
            '.header-account',
            '.account-dropdown',
            '.user-menu',
            'a[href*="account"]',
            'a[href*="profile"]',
            '.member-name',
            '.welcome',
            '[class*="account"]',
            '[class*="profile"]',
            '[class*="member"]',
            'button[aria-label*="account" i]',
            'button[aria-label*="profile" i]',
            '.signin-out', // Marriott specific
            '.account-signin-out' // Marriott specific
        ];

        console.log('🔍 Checking login status...');
        
        // Debug: log all potential login elements found
        let foundElements = [];
        loginIndicators.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
                foundElements.push({
                    selector: selector,
                    count: elements.length,
                    text: Array.from(elements).map(el => el.textContent?.trim()).filter(Boolean)
                });
            }
        });
        
        if (foundElements.length > 0) {
            console.log('✅ Found potential login indicators:', foundElements);
        } else {
            console.log('❌ No login indicators found');
            
            // Additional debugging - check for any text that might indicate login
            const bodyText = document.body.textContent.toLowerCase();
            const loginKeywords = ['sign out', 'logout', 'my account', 'welcome back', 'member', 'profile'];
            const foundKeywords = loginKeywords.filter(keyword => bodyText.includes(keyword));
            
            if (foundKeywords.length > 0) {
                console.log('📝 Found login-related text:', foundKeywords);
            }
            
            // Check for text-based indicators
            const textIndicators = checkTextBasedLogin();
            if (textIndicators.length > 0) {
                console.log('📝 Found text-based login indicators:', textIndicators);
                return true; // If we find text indicators, consider logged in
            }
            
            // Check for absence of login/signin buttons (which might indicate already logged in)
            const signInLinks = Array.from(document.querySelectorAll('a')).filter(a => 
                a.textContent.toLowerCase().includes('sign in') || 
                a.textContent.toLowerCase().includes('login')
            );
            const signInButtons = Array.from(document.querySelectorAll('button')).filter(btn => 
                btn.textContent.toLowerCase().includes('sign in') || 
                btn.textContent.toLowerCase().includes('login')
            );
            
            console.log('🔐 Sign in links found:', signInLinks.length);
            console.log('🔐 Sign in buttons found:', signInButtons.length);
            
            // If no sign-in buttons/links found, might be logged in
            if (signInLinks.length === 0 && signInButtons.length === 0) {
                console.log('🤔 No sign-in elements found - might be logged in');
                return true;
            }
        }

        return foundElements.length > 0;
    }

    function checkTextBasedLogin() {
        const indicators = [];
        const bodyText = document.body.textContent.toLowerCase();
        
        // Look for text patterns that indicate user is logged in
        const patterns = [
            /welcome back/i,
            /signed in as/i,
            /logged in as/i,
            /hello,?\s+\w+/i,
            /my account/i,
            /sign out/i,
            /logout/i,
            /member\s+\w+/i,
            /points?[\s:]+[\d,]+/i // Points balance indicates logged in
        ];
        
        patterns.forEach((pattern, index) => {
            if (pattern.test(document.body.textContent)) {
                indicators.push(`Pattern ${index + 1}: ${pattern.source}`);
            }
        });
        
        return indicators;
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

    async function extractReservationDataFromElements(foundElements) {
        const reservations = [];
        
        sendDebug('info', `Found ${foundElements.length} potential reservation elements`);
        
        // First, try to find trip panels that need to be clicked
        const tripPanels = await findTripPanels();
        
        if (tripPanels.length > 0) {
            sendDebug('success', `Found ${tripPanels.length} trip panels to process`);
            
            for (let i = 0; i < tripPanels.length; i++) {
                sendProgress(60 + (i * 30) / tripPanels.length, `Processing trip ${i + 1} of ${tripPanels.length}...`);
                
                try {
                    const reservation = await processTripPanel(tripPanels[i], i);
                    if (reservation && reservation.hotelName) {
                        reservations.push(reservation);
                        sendDebug('success', `Successfully extracted trip ${i + 1}: ${reservation.hotelName}`);
                    }
                } catch (error) {
                    sendDebug('error', `Failed to process trip ${i + 1}: ${error.message}`);
                }
                
                // Small delay between trips
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } else {
            // Fallback to basic extraction from found elements
            sendDebug('warning', 'No trip panels found, trying basic extraction...');
            
            for (let i = 0; i < foundElements.length; i++) {
                const element = foundElements[i];
                
                try {
                    const reservation = await extractSingleReservation(element);
                    
                    if (reservation && reservation.hotelName) {
                        if (isUpcomingReservation(reservation)) {
                            reservations.push(reservation);
                        }
                    }
                } catch (error) {
                    sendDebug('warning', `Failed to extract from element ${i + 1}: ${error.message}`);
                }
            }
        }

        return reservations;
    }

    async function findTripPanels() {
        sendDebug('info', 'Looking for clickable trip panels...');
        
        const selectors = [
            '[class*="trip"]',
            '[class*="reservation"]', 
            '[class*="booking"]',
            '[data-testid*="trip"]',
            '[data-testid*="reservation"]',
            '.accordion__heading',
            'button[aria-expanded]',
            '[role="button"]',
            'div[onclick]',
            'div[role="button"]'
        ];
        
        let panels = [];
        
        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                const text = element.textContent.toLowerCase();
                if ((text.includes('hotel') || text.includes('marriott')) && 
                    (text.includes('check') || text.includes('night') || text.includes('reservation'))) {
                    
                    // Check if it looks like a clickable panel
                    if (element.tagName === 'BUTTON' || 
                        element.getAttribute('role') === 'button' ||
                        element.onclick ||
                        element.getAttribute('aria-expanded') !== null ||
                        element.style.cursor === 'pointer') {
                        
                        panels.push(element);
                        sendDebug('info', `Found clickable panel: ${text.substring(0, 100)}...`);
                    }
                }
            }
            
            if (panels.length > 0) break;
        }
        
        // Remove duplicates
        panels = panels.filter((panel, index, self) => 
            self.findIndex(p => p === panel) === index
        );
        
        return panels.slice(0, 10); // Limit to 10 trips
    }

    async function processTripPanel(panel, index) {
        sendDebug('info', `Processing trip panel ${index + 1}...`);
        
        try {
            // Step 1: Click the panel to expand it
            sendDebug('info', 'Clicking trip panel to expand...');
            panel.click();
            
            // Wait for panel to expand
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Step 2: Look for View/Modify Room button
            const viewButton = await findViewModifyButton(panel);
            
            if (viewButton) {
                sendDebug('info', 'Found View/Modify Room button, clicking...');
                
                // Store current URL to navigate back later
                const originalUrl = window.location.href;
                
                // Click the view/modify button
                viewButton.click();
                
                // Wait for navigation to detailed page
                await waitForNavigation(originalUrl);
                
                // Step 3: Extract detailed reservation data
                const reservation = await extractDetailedReservationData();
                
                // Step 4: Navigate back to trips list
                if (window.location.href !== originalUrl) {
                    sendDebug('info', 'Navigating back to trips list...');
                    window.history.back();
                    await waitForPageLoad();
                }
                
                return reservation;
                
            } else {
                sendDebug('warning', 'No View/Modify Room button found, trying basic extraction...');
                return await extractSingleReservation(panel);
            }
            
        } catch (error) {
            sendDebug('error', `Error processing trip panel: ${error.message}`);
            return null;
        }
    }

    async function findViewModifyButton(context = document) {
        sendDebug('info', 'Looking for View/Modify Room button...');
        
        const buttonSelectors = [
            'button:contains("View")',
            'button:contains("Modify")', 
            'a:contains("View")',
            'a:contains("Modify")',
            '[aria-label*="view" i]',
            '[aria-label*="modify" i]',
            '.view-button',
            '.modify-button'
        ];
        
        // Wait up to 5 seconds for the button to appear
        for (let i = 0; i < 10; i++) {
            for (const selector of buttonSelectors) {
                const buttons = context.querySelectorAll('button, a, [role="button"]');
                
                for (const button of buttons) {
                    const text = button.textContent.toLowerCase();
                    const ariaLabel = button.getAttribute('aria-label')?.toLowerCase() || '';
                    
                    if (text.includes('view') || text.includes('modify') ||
                        ariaLabel.includes('view') || ariaLabel.includes('modify')) {
                        
                        sendDebug('success', `Found button: "${button.textContent.trim()}"`);
                        return button;
                    }
                }
            }
            
            // Wait 500ms before trying again
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        sendDebug('warning', 'No View/Modify Room button found after 5 seconds');
        return null;
    }

    async function waitForNavigation(originalUrl) {
        sendDebug('info', 'Waiting for page navigation...');
        
        // Wait up to 10 seconds for navigation
        for (let i = 0; i < 20; i++) {
            if (window.location.href !== originalUrl) {
                sendDebug('success', `Navigated to: ${window.location.href}`);
                await waitForPageLoad();
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        sendDebug('warning', 'No navigation detected after 10 seconds');
    }

    async function extractDetailedReservationData() {
        sendDebug('info', 'Extracting detailed reservation data from current page...');
        
        await waitForPageLoad();
        
        const reservation = {
            extractedAt: new Date().toISOString(),
            source: window.location.href,
            detailedPage: true
        };

        // Extract hotel name
        reservation.hotelName = extractText(document, [
            'h1', 'h2',
            '[class*="hotel"]',
            '[class*="property"]',
            '[data-testid*="hotel"]',
            '.title'
        ]) || extractHotelNameFromText(document);

        // Extract confirmation number
        reservation.confirmationNumber = extractText(document, [
            '[class*="confirmation"]',
            '[class*="number"]',
            '[data-testid*="confirmation"]'
        ]) || extractConfirmationFromText(document);

        // Extract dates with more detail
        const dates = extractDatesDetailed(document);
        reservation.checkInDate = dates.checkIn;
        reservation.checkOutDate = dates.checkOut;

        // Calculate nights
        if (dates.checkIn && dates.checkOut) {
            const checkIn = new Date(dates.checkIn);
            const checkOut = new Date(dates.checkOut);
            const timeDiff = checkOut - checkIn;
            reservation.nights = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
        }

        // Extract detailed costs and pricing
        const costs = extractDetailedCosts(document);
        reservation.totalCost = costs.total;
        reservation.pricePerNight = costs.perNight;
        reservation.baseRate = costs.baseRate;
        reservation.taxes = costs.taxes;
        reservation.fees = costs.fees;

        // Extract points information
        reservation.pointsUsed = extractDetailedPoints(document);
        reservation.pointsEarned = extractPointsEarned(document);

        // Extract promo code information
        reservation.promoCode = extractDetailedPromoCode(document);

        // Extract room type
        reservation.roomType = extractText(document, [
            '[class*="room"]',
            '[data-testid*="room"]',
            '.accommodation'
        ]);

        // Extract payment method
        reservation.paymentMethod = extractPaymentMethod(document);

        // Extract cancellation policy
        reservation.cancellationPolicy = extractCancellationPolicy(document);

        sendDebug('success', `Extracted detailed data for: ${reservation.hotelName}`);
        return reservation;
    }

    function extractDatesDetailed(element) {
        const dates = { checkIn: null, checkOut: null };
        const text = element.textContent;

        // Look for more detailed date selectors
        const checkInSelectors = [
            '[class*="check-in"]', '[class*="checkin"]', '[data-testid*="checkin"]',
            '[class*="arrival"]', '[data-testid*="arrival"]',
            '.date-in', '.arrival-date'
        ];
        const checkOutSelectors = [
            '[class*="check-out"]', '[class*="checkout"]', '[data-testid*="checkout"]',
            '[class*="departure"]', '[data-testid*="departure"]',
            '.date-out', '.departure-date'
        ];

        dates.checkIn = extractText(element, checkInSelectors);
        dates.checkOut = extractText(element, checkOutSelectors);

        // Enhanced pattern matching
        if (!dates.checkIn || !dates.checkOut) {
            const patterns = [
                /check.?in:?\s*([a-z]{3}\s+\d{1,2},?\s+\d{4})/i,
                /arrival:?\s*([a-z]{3}\s+\d{1,2},?\s+\d{4})/i,
                /(\d{1,2}\/\d{1,2}\/\d{4})/g,
                /(\d{4}-\d{2}-\d{2})/g
            ];
            
            for (const pattern of patterns) {
                const matches = text.match(pattern);
                if (matches && matches.length >= 2) {
                    dates.checkIn = dates.checkIn || matches[0];
                    dates.checkOut = dates.checkOut || matches[1];
                    break;
                }
            }
        }

        if (dates.checkIn) dates.checkIn = parseDate(dates.checkIn);
        if (dates.checkOut) dates.checkOut = parseDate(dates.checkOut);

        return dates;
    }

    function extractDetailedCosts(element) {
        const costs = { total: null, perNight: null, baseRate: null, taxes: null, fees: null };
        const text = element.textContent;

        // Look for various cost components
        const selectors = {
            total: ['.total', '.grand-total', '[class*="total"]', '[data-testid*="total"]'],
            perNight: ['.per-night', '.nightly', '[class*="night"]', '.rate'],
            baseRate: ['.base-rate', '.room-rate', '[class*="base"]'],
            taxes: ['.tax', '.taxes', '[class*="tax"]'],
            fees: ['.fee', '.fees', '[class*="fee"]']
        };

        Object.keys(selectors).forEach(key => {
            costs[key] = extractText(element, selectors[key]);
        });

        // Extract from text patterns
        const patterns = {
            total: /total[:\s]*\$?([0-9,]+\.?\d*)/i,
            perNight: /\$?([0-9,]+\.?\d*)\s*per\s*night/i,
            baseRate: /room\s*rate[:\s]*\$?([0-9,]+\.?\d*)/i,
            taxes: /tax[es]*[:\s]*\$?([0-9,]+\.?\d*)/i,
            fees: /fee[s]*[:\s]*\$?([0-9,]+\.?\d*)/i
        };

        Object.keys(patterns).forEach(key => {
            if (!costs[key]) {
                const match = text.match(patterns[key]);
                if (match) costs[key] = '$' + match[1];
            }
        });

        return costs;
    }

    function extractDetailedPoints(element) {
        const text = element.textContent;
        const patterns = [
            /(\d+,?\d*)\s*points?\s*used/i,
            /used[:\s]*(\d+,?\d*)\s*points?/i,
            /redeem[ed]*[:\s]*(\d+,?\d*)\s*points?/i,
            /points?\s*redeemed[:\s]*(\d+,?\d*)/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1].replace(',', '');
            }
        }

        // Look for elements with "points" in class names
        const pointsElements = element.querySelectorAll('[class*="point"], [data-testid*="point"]');
        for (const el of pointsElements) {
            const pointMatch = el.textContent.match(/(\d+,?\d*)/);
            if (pointMatch) {
                return pointMatch[1].replace(',', '');
            }
        }

        return null;
    }

    function extractPointsEarned(element) {
        const text = element.textContent;
        const patterns = [
            /earn[ed]*[:\s]*(\d+,?\d*)\s*points?/i,
            /(\d+,?\d*)\s*points?\s*earned/i,
            /points?\s*earned[:\s]*(\d+,?\d*)/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1].replace(',', '');
            }
        }
        return null;
    }

    function extractDetailedPromoCode(element) {
        const text = element.textContent;
        const patterns = [
            /promo[tion]*\s*code[:\s]*([A-Z0-9]+)/i,
            /discount\s*code[:\s]*([A-Z0-9]+)/i,
            /offer\s*code[:\s]*([A-Z0-9]+)/i,
            /corporate\s*code[:\s]*([A-Z0-9]+)/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1];
            }
        }

        // Look for elements with promo-related class names
        const promoElements = element.querySelectorAll('[class*="promo"], [class*="discount"], [class*="offer"]');
        for (const el of promoElements) {
            const codeMatch = el.textContent.match(/([A-Z0-9]{3,})/);
            if (codeMatch) {
                return codeMatch[1];
            }
        }

        return null;
    }

    function extractPaymentMethod(element) {
        const text = element.textContent;
        const patterns = [
            /payment[:\s]*([a-z0-9\s*]+\d{4})/i,
            /card[:\s]*([a-z]+\s*\*+\d{4})/i,
            /(visa|mastercard|amex|discover)\s*\*+\d{4}/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1] || match[0];
            }
        }
        return null;
    }

    function extractCancellationPolicy(element) {
        const text = element.textContent.toLowerCase();
        if (text.includes('free cancellation')) {
            return 'Free cancellation';
        } else if (text.includes('non-refundable')) {
            return 'Non-refundable';
        } else if (text.includes('cancellation fee')) {
            return 'Cancellation fee applies';
        }
        return null;
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

    function sendDebug(type, message) {
        console.log(`🔧 [${type.toUpperCase()}] ${message}`);
        chrome.runtime.sendMessage({
            action: 'debug',
            type: type,
            message: message
        });
    }

    async function findAndAnalyzeReservations() {
        sendDebug('info', 'Starting reservation element analysis...');
        
        // First, wait for the page to be fully loaded
        await waitForPageLoad();
        
        // Check for any reservation-related text content
        const pageText = document.body.textContent.toLowerCase();
        sendDebug('info', `Page contains "reservation": ${pageText.includes('reservation')}`);
        sendDebug('info', `Page contains "trip": ${pageText.includes('trip')}`);
        sendDebug('info', `Page contains "booking": ${pageText.includes('booking')}`);
        sendDebug('info', `Page contains "hotel": ${pageText.includes('hotel')}`);
        
        // Try multiple strategies to find reservation containers
        const strategies = [
            () => findBySelectors(),
            () => findByTextContent(),
            () => findByFormElements(),
            () => findByTableStructure()
        ];
        
        let foundElements = [];
        for (let i = 0; i < strategies.length; i++) {
            sendDebug('info', `Trying strategy ${i + 1}...`);
            const elements = await strategies[i]();
            if (elements.length > 0) {
                sendDebug('success', `Strategy ${i + 1} found ${elements.length} elements`);
                foundElements = elements;
                break;
            } else {
                sendDebug('warning', `Strategy ${i + 1} found no elements`);
            }
        }
        
        if (foundElements.length === 0) {
            sendDebug('error', 'No reservation elements found with any strategy');
            // Try to find ANY elements with reservation-related classes or text
            await lastResortAnalysis();
            throw new Error('No reservations found. You may need to navigate to your reservations page first.');
        }
        
        return foundElements;
    }

    async function findBySelectors() {
        const selectors = [
            '.reservation-card', '.trip-card', '.booking-card',
            '[data-testid*="reservation"]', '[data-testid*="trip"]',
            '.upcoming-stay', '.future-reservation',
            '.reservation', '.trip', '.booking',
            '[class*="reservation"]', '[class*="trip"]', '[class*="booking"]',
            '.stay-card', '.hotel-reservation'
        ];
        
        let elements = [];
        for (const selector of selectors) {
            const found = document.querySelectorAll(selector);
            if (found.length > 0) {
                sendDebug('info', `Selector "${selector}" found ${found.length} elements`);
                elements = Array.from(found);
                break;
            }
        }
        
        return elements;
    }

    async function findByTextContent() {
        sendDebug('info', 'Searching by text content...');
        const allDivs = document.querySelectorAll('div, section, article');
        const elements = [];
        
        for (const div of allDivs) {
            const text = div.textContent.toLowerCase();
            if ((text.includes('hotel') || text.includes('marriott')) && 
                (text.includes('check') || text.includes('night') || text.includes('reservation'))) {
                // Make sure it's not a tiny element
                if (div.textContent.length > 50) {
                    elements.push(div);
                    sendDebug('info', `Found potential reservation by text: ${div.textContent.substring(0, 100)}...`);
                }
            }
        }
        
        return elements.slice(0, 10); // Limit to first 10
    }

    async function findByFormElements() {
        sendDebug('info', 'Searching for forms or tables...');
        const forms = document.querySelectorAll('form');
        const tables = document.querySelectorAll('table');
        const elements = [];
        
        [...forms, ...tables].forEach(element => {
            const text = element.textContent.toLowerCase();
            if (text.includes('reservation') || text.includes('confirmation') || text.includes('hotel')) {
                elements.push(element);
                sendDebug('info', `Found form/table with reservation content`);
            }
        });
        
        return elements;
    }

    async function findByTableStructure() {
        sendDebug('info', 'Searching table rows...');
        const rows = document.querySelectorAll('tr, tbody > *, .table-row');
        const elements = [];
        
        for (const row of rows) {
            const text = row.textContent.toLowerCase();
            if (text.includes('hotel') && (text.includes('check') || text.includes('night'))) {
                elements.push(row);
                sendDebug('info', `Found table row with hotel content`);
            }
        }
        
        return elements;
    }

    async function lastResortAnalysis() {
        sendDebug('warning', 'Performing last resort analysis...');
        
        // Log all elements that contain specific keywords
        const keywords = ['hotel', 'reservation', 'confirmation', 'marriott', 'check-in', 'check-out'];
        
        keywords.forEach(keyword => {
            const xpath = `//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${keyword}')]`;
            const result = document.evaluate(xpath, document, null, XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE, null);
            
            if (result.snapshotLength > 0) {
                sendDebug('info', `Found ${result.snapshotLength} elements containing "${keyword}"`);
                
                // Log first few elements
                for (let i = 0; i < Math.min(3, result.snapshotLength); i++) {
                    const element = result.snapshotItem(i);
                    sendDebug('info', `  - ${element.tagName}: ${element.textContent.substring(0, 100)}...`);
                }
            }
        });
        
        // Check if we're on the right page
        if (!window.location.href.includes('reservation') && !window.location.href.includes('trip')) {
            sendDebug('warning', 'Not on reservations page - trying to navigate...');
            // You might want to add navigation logic here
        }
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
