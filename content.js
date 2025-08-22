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
            sendProgress(5, 'Checking login status...');
            
            sendDebug('info', '🚀 Starting reservation extraction...');
            sendDebug('info', `📍 Current URL: ${window.location.href}`);
            sendDebug('info', `🌐 Domain: ${window.location.hostname}`);
            
            // Check if user is logged in
            const loginStatus = isLoggedIn();
            sendDebug('info', `🔑 Login status result: ${loginStatus}`);
            
            if (!loginStatus) {
                sendDebug('error', '❌ Login check failed - throwing error');
                throw new Error('Please log in to your Marriott account first. Check browser console for debugging details.');
            }
            
            sendDebug('success', '✅ Login check passed - continuing extraction');

            sendProgress(15, 'Navigating to My Trips page...');
            sendDebug('info', 'Automatically navigating to trips page...');
            
            // Always navigate to the trips page first
            await navigateToTripsPage();
            
            sendProgress(40, 'Scanning for upcoming reservations...');
            
            // Debug: Check what's actually on the page
            sendDebug('info', `Page title: ${document.title}`);
            sendDebug('info', `Page URL: ${window.location.href}`);
            sendDebug('info', `Body text length: ${document.body.textContent.length} characters`);
            
            sendProgress(50, 'Analyzing page content...');
            
            // Extract reservation data using found elements
            const foundElements = await findAndAnalyzeReservations();
            
            sendProgress(60, 'Extracting reservation details...');
            sendDebug('info', 'Starting detailed extraction process...');
            
            const reservations = await extractReservationDataFromElements(foundElements);
            
            sendDebug('info', `Extraction completed, found ${reservations.length} reservations`);
            
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
            sendDebug('error', `Extraction failed: ${error.message}`);
            console.error('🏨 MARRIOTT EXTRACTOR - Extraction error:', error);
            chrome.runtime.sendMessage({
                action: 'extractionError',
                error: error.message
            });
        } finally {
            extractionInProgress = false;
            sendDebug('info', 'Extraction process completed');
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

        sendDebug('info', '🔍 Checking login status...');
        
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
            sendDebug('success', `✅ Found ${foundElements.length} potential login indicators`);
        } else {
            sendDebug('error', '❌ No login indicators found');
            
            // Additional debugging - check for any text that might indicate login
            const bodyText = document.body.textContent.toLowerCase();
            const loginKeywords = ['sign out', 'logout', 'my account', 'welcome back', 'member', 'profile'];
            const foundKeywords = loginKeywords.filter(keyword => bodyText.includes(keyword));
            
            if (foundKeywords.length > 0) {
                sendDebug('info', `📝 Found login-related text: ${foundKeywords.join(', ')}`);
            }
            
            // Check for text-based indicators
            const textIndicators = checkTextBasedLogin();
            if (textIndicators.length > 0) {
                sendDebug('success', `📝 Found ${textIndicators.length} text-based login indicators`);
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
            
            sendDebug('info', `🔐 Sign in links found: ${signInLinks.length}`);
            sendDebug('info', `🔐 Sign in buttons found: ${signInButtons.length}`);
            
            // If no sign-in buttons/links found, might be logged in
            if (signInLinks.length === 0 && signInButtons.length === 0) {
                sendDebug('info', '🤔 No sign-in elements found - assuming logged in');
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

    async function navigateToTripsPage() {
        const tripsUrl = 'https://www.marriott.com/loyalty/findReservationList.mi';
        const currentUrl = window.location.href;
        
        sendDebug('info', `Current URL: ${currentUrl}`);
        sendDebug('info', `Target URL: ${tripsUrl}`);
        
        // Check if we're already on the trips page
        if (currentUrl.includes('findReservationList.mi')) {
            sendDebug('info', 'Already on trips page, skipping navigation');
            sendProgress(30, 'Already on trips page, waiting for content...');
            
            // Wait for content to load without refreshing
            await waitForTripContent();
            
            sendDebug('success', 'Trips page content loaded');
        } else {
            sendDebug('info', 'Navigating to trips page...');
            sendProgress(20, 'Loading My Trips page...');
            
            window.location.href = tripsUrl;
            
            // Wait for navigation and page load
            await waitForPageLoad();
            sendDebug('info', 'Page loaded, waiting for trip content...');
            
            await waitForTripContent();
            
            sendDebug('success', 'Successfully navigated and loaded trips page');
        }
        
        sendProgress(35, 'Trips page ready, scanning for reservations...');
    }

    async function waitForTripContent() {
        sendDebug('info', 'Waiting for trip content to load...');
        
        // Wait up to 10 seconds for trip content to appear
        for (let i = 0; i < 20; i++) {
            const tripElements = document.querySelectorAll('[class*="trip"], [class*="reservation"], [class*="booking"], .accordion');
            const hasContent = tripElements.length > 0 || document.body.textContent.includes('reservation') || document.body.textContent.includes('trip');
            
            if (hasContent) {
                sendDebug('success', `Trip content found after ${i * 500}ms`);
                return;
            }
            
            sendDebug('info', `Waiting for content... (${i + 1}/20)`);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        sendDebug('warning', 'Trip content not found after 10 seconds, proceeding anyway');
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
                    // Try Marriott-specific extraction first
                    let reservation = await extractMarriottReservation(element);
                    
                    // Fallback to generic extraction
                    if (!reservation || !reservation.hotelName) {
                        reservation = await extractSingleReservation(element);
                    }
                    
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

    async function extractMarriottReservation(element) {
        sendDebug('info', 'Attempting Marriott-specific extraction...');
        
        const reservation = {
            hotelName: '',
            checkInDate: '',
            checkOutDate: '',
            confirmationNumber: '',
            roomType: '',
            address: '',
            totalCost: '',
            viewModifyLink: '',
            extractedAt: new Date().toISOString(),
            source: 'Marriott Trips Page',
            detailedPage: false
        };

        try {
            // Extract hotel name from t-subtitle-l element
            const nameElement = element.querySelector('.t-subtitle-l, [class*="t-subtitle-l"], .name, [class*="name"]');
            if (nameElement) {
                reservation.hotelName = nameElement.textContent.trim();
                sendDebug('info', `Found hotel name: ${reservation.hotelName}`);
            }

            // Extract dates from t-title-m element
            const dateElement = element.querySelector('.t-title-m, [class*="t-title-m"], .date, [class*="date"]');
            if (dateElement) {
                const dateText = dateElement.textContent.trim();
                sendDebug('info', `Found date text: ${dateText}`);
                
                // Parse date range (common format: "Dec 15 - Dec 18, 2024")
                const dateMatch = dateText.match(/(\w+\s+\d+)\s*-\s*(\w+\s+\d+)/);
                if (dateMatch) {
                    const currentYear = new Date().getFullYear();
                    reservation.checkInDate = parseDate(`${dateMatch[1]}, ${currentYear}`);
                    reservation.checkOutDate = parseDate(`${dateMatch[2]}, ${currentYear}`);
                    
                    // Calculate nights
                    const nights = calculateNights(reservation.checkInDate, reservation.checkOutDate);
                    if (nights > 0) {
                        reservation.nights = nights;
                    }
                }
            }

            // Extract confirmation number
            const confirmationSelectors = [
                '.confirmation', '[class*="confirmation"]',
                '.conf-number', '[class*="conf"]',
                '.booking-ref', '[class*="booking"]'
            ];
            
            for (const selector of confirmationSelectors) {
                const confElement = element.querySelector(selector);
                if (confElement) {
                    const confText = confElement.textContent;
                    const confMatch = confText.match(/[A-Z0-9]{6,}/);
                    if (confMatch) {
                        reservation.confirmationNumber = confMatch[0];
                        sendDebug('info', `Found confirmation: ${reservation.confirmationNumber}`);
                        break;
                    }
                }
            }

            // Extract view/modify room link
            const linkSelectors = [
                'a[href*="modify"]', 'a[href*="view"]', 
                '.view', '.modify', '.manage',
                '[class*="view"]', '[class*="modify"]', '[class*="manage"]'
            ];
            
            for (const selector of linkSelectors) {
                const linkElement = element.querySelector(selector);
                if (linkElement) {
                    reservation.viewModifyLink = linkElement.href || linkElement.textContent;
                    sendDebug('info', `Found view/modify link: ${reservation.viewModifyLink}`);
                    break;
                }
            }

            // Extract address
            const addressSelectors = [
                '.address', '[class*="address"]',
                '.location', '[class*="location"]',
                '.city', '[class*="city"]'
            ];
            
            for (const selector of addressSelectors) {
                const addressElement = element.querySelector(selector);
                if (addressElement) {
                    reservation.address = addressElement.textContent.trim();
                    sendDebug('info', `Found address: ${reservation.address}`);
                    break;
                }
            }

            // Extract cost information
            const costSelectors = [
                '.cost', '.price', '.total', '.amount',
                '[class*="cost"]', '[class*="price"]', '[class*="total"]', '[class*="amount"]'
            ];
            
            for (const selector of costSelectors) {
                const costElement = element.querySelector(selector);
                if (costElement) {
                    const costText = costElement.textContent;
                    const costMatch = costText.match(/\$[\d,]+\.?\d*/);
                    if (costMatch) {
                        reservation.totalCost = costMatch[0];
                        sendDebug('info', `Found cost: ${reservation.totalCost}`);
                        break;
                    }
                }
            }

            // Calculate price per night if we have total cost and nights
            if (reservation.totalCost && reservation.nights) {
                const totalAmount = parseFloat(reservation.totalCost.replace(/[$,]/g, ''));
                if (!isNaN(totalAmount) && reservation.nights > 0) {
                    const perNight = totalAmount / reservation.nights;
                    reservation.pricePerNight = `$${perNight.toFixed(2)}`;
                }
            }

            // If we found a hotel name, consider this a valid extraction
            if (reservation.hotelName) {
                sendDebug('success', `Marriott extraction successful for ${reservation.hotelName}`);
                return reservation;
            } else {
                sendDebug('warning', 'Marriott extraction failed - no hotel name found');
                return null;
            }

        } catch (error) {
            sendDebug('error', `Marriott extraction error: ${error.message}`);
            return null;
        }
    }

    async function findTripPanels() {
        sendDebug('info', 'Looking for clickable trip panels...');
        
        // Updated selectors to include Marriott-specific ones
        const selectors = [
            // Marriott-specific trip panel containers
            '.upcomingtrips .mb-5', '.color-scheme7 .mb-5',
            '[class*="upcomingtrips"] div', '[class*="color-scheme"] div',
            
            // Generic trip selectors
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
        const timestamp = new Date().toLocaleTimeString();
        const logMessage = `🏨 MARRIOTT EXTRACTOR [${timestamp}] [${type.toUpperCase()}] ${message}`;
        console.log(logMessage);
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
        sendDebug('info', 'Searching for individual trip containers...');
        
        // Strategy 1: Look for accordion containers with multiple trips
        const accordionContainers = document.querySelectorAll('.accordion, [class*="accordion"], .gOEOgy');
        if (accordionContainers.length > 0) {
            sendDebug('info', `Found ${accordionContainers.length} accordion containers`);
            
            const individualTrips = [];
            for (const container of accordionContainers) {
                // Look for individual trip sections within accordions
                const tripSections = container.querySelectorAll('.accordion__container, .accordion__item, [class*="accordion__"]');
                
                tripSections.forEach((section, index) => {
                    const text = section.textContent.toLowerCase();
                    // Look for generic trip indicators that would work for any user
                    if ((text.includes('check') || text.includes('night') || text.includes('reservation') || 
                         text.includes('confirm') || text.includes('booking')) && 
                        text.length > 100 && text.length < 2000) {
                        sendDebug('info', `Found trip section ${index + 1} in accordion: ${text.substring(0, 100)}...`);
                        individualTrips.push(section);
                    }
                });
            }
            
            if (individualTrips.length > 0) {
                sendDebug('success', `Found ${individualTrips.length} individual trip sections in accordions`);
                return individualTrips;
            }
        }

        // Strategy 2: Look for cards or panels that contain hotel/trip data
        const cardSelectors = [
            '.card', '.panel', '.mb-5', '[class*="card"]', '[class*="panel"]'
        ];
        
        for (const selector of cardSelectors) {
            const cards = document.querySelectorAll(selector);
            const tripCards = [];
            
            cards.forEach((card, index) => {
                const text = card.textContent.toLowerCase();
                // Look for cards that contain generic trip information but aren't too large (like entire pages)
                if ((text.includes('check') || text.includes('night') || text.includes('reservation') || 
                     text.includes('confirm') || text.includes('booking') ||
                     /\$\d+/.test(text) || // Contains money amounts
                     /\d{1,2}[\/\-]\d{1,2}/.test(text)) && // Contains date patterns
                    text.length < 2000 && text.length > 100) {
                    
                    sendDebug('info', `Found trip card ${index + 1}: ${text.substring(0, 100)}...`);
                    tripCards.push(card);
                }
            });
            
            if (tripCards.length > 1) { // Only return if we found multiple trip cards
                sendDebug('success', `Found ${tripCards.length} individual trip cards with selector "${selector}"`);
                return tripCards;
            }
        }

        // Strategy 3: Look for sibling elements with similar structure (trip containers)
        sendDebug('info', 'Searching for sibling trip containers...');
        const allDivs = document.querySelectorAll('div');
        const potentialTripContainers = [];
        
        allDivs.forEach((div) => {
            const text = div.textContent.trim();
            
            // Look for elements that contain trip indicators but aren't too large
            const hasTripIndicators = (
                text.includes('check') || 
                text.includes('night') || 
                text.includes('reservation') || 
                text.includes('booking') ||
                text.includes('confirm') ||
                /\$\d+/.test(text) || // Contains money amounts
                /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(text) || // Contains dates
                /\b\d{1,2}\s*-\s*\d{1,2}\b/.test(text) // Date ranges like "15 - 18"
            );
            
            // Must be reasonably sized and contain meaningful content
            if (hasTripIndicators && text.length > 100 && text.length < 2000 && div.offsetHeight > 0) {
                potentialTripContainers.push(div);
            }
        });
        
        // Group elements by similar structure and parent containers
        const groupedContainers = groupSimilarElements(potentialTripContainers);
        
        if (groupedContainers.length > 1) {
            sendDebug('success', `Found ${groupedContainers.length} similar trip containers`);
            return groupedContainers;
        }

        sendDebug('warning', 'No individual trip containers found with any strategy');
        return [];
    }

    function groupSimilarElements(elements) {
        if (elements.length < 2) return elements;
        
        // Find elements that have similar structure (same parent or similar siblings)
        const groups = [];
        const processed = new Set();
        
        elements.forEach((element, index) => {
            if (processed.has(element)) return;
            
            const siblings = [];
            const parent = element.parentElement;
            
            if (parent) {
                // Look for similar elements within the same parent
                elements.forEach((otherElement, otherIndex) => {
                    if (otherIndex !== index && 
                        !processed.has(otherElement) && 
                        otherElement.parentElement === parent) {
                        
                        // Check if elements have similar structure
                        const similarity = calculateElementSimilarity(element, otherElement);
                        if (similarity > 0.3) { // 30% similarity threshold
                            siblings.push(otherElement);
                            processed.add(otherElement);
                        }
                    }
                });
            }
            
            if (siblings.length > 0) {
                siblings.push(element);
                processed.add(element);
                groups.push(...siblings);
            }
        });
        
        // If grouping didn't work well, return elements that look like individual trip containers
        if (groups.length < 2) {
            return elements.filter(el => {
                const text = el.textContent;
                // Look for elements that seem to be individual trip containers
                return text.length > 200 && text.length < 1500 && 
                       (text.includes('check') || text.includes('night') || text.includes('confirm'));
            }).slice(0, 20); // Limit to reasonable number
        }
        
        return groups;
    }

    function calculateElementSimilarity(el1, el2) {
        // Compare elements based on their structure
        const tag1 = el1.tagName;
        const tag2 = el2.tagName;
        
        const classes1 = Array.from(el1.classList).sort().join(' ');
        const classes2 = Array.from(el2.classList).sort().join(' ');
        
        const children1 = el1.children.length;
        const children2 = el2.children.length;
        
        let similarity = 0;
        
        // Same tag name
        if (tag1 === tag2) similarity += 0.3;
        
        // Similar class structure
        if (classes1 === classes2) similarity += 0.4;
        else if (classes1 && classes2) {
            const commonClasses = classes1.split(' ').filter(c => classes2.includes(c));
            similarity += (commonClasses.length / Math.max(classes1.split(' ').length, classes2.split(' ').length)) * 0.4;
        }
        
        // Similar number of children
        if (Math.abs(children1 - children2) <= 2) similarity += 0.3;
        
        return similarity;
    }

    async function handleTripPanelExpansion(tripPanels) {
        sendDebug('info', `Processing ${tripPanels.length} trip panels for expansion...`);
        const expandedPanels = [];
        
        for (let i = 0; i < tripPanels.length; i++) {
            const panel = tripPanels[i];
            sendDebug('info', `Processing trip panel ${i + 1}/${tripPanels.length}`);
            
            try {
                // Look for toggle button within this panel
                const toggleSelectors = [
                    '.a-ui-library-Icon[testid="toggle"]',
                    '[data-testid="toggle"]', 
                    '[testid="toggle"]',
                    '.icon.arrow',
                    '[class*="arrow"]',
                    'button[class*="toggle"]',
                    'button[class*="expand"]'
                ];
                
                let toggleButton = null;
                for (const selector of toggleSelectors) {
                    toggleButton = panel.querySelector(selector);
                    if (toggleButton) {
                        sendDebug('info', `Found toggle button with selector: ${selector}`);
                        break;
                    }
                }
                
                if (toggleButton) {
                    // Check if panel is already expanded
                    const isExpanded = toggleButton.classList.contains('arrow-up') || 
                                     toggleButton.getAttribute('aria-expanded') === 'true' ||
                                     panel.querySelector('.view, .modify, .cancel, [href*="modify"]');
                    
                    if (!isExpanded) {
                        sendDebug('info', `Expanding trip panel ${i + 1} by clicking toggle...`);
                        toggleButton.click();
                        
                        // Wait for expansion
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        // Wait for content to load
                        await waitForExpansionContent(panel);
                    } else {
                        sendDebug('info', `Trip panel ${i + 1} already expanded`);
                    }
                } else {
                    sendDebug('warning', `No toggle button found in panel ${i + 1}`);
                }
                
                expandedPanels.push(panel);
            } catch (error) {
                sendDebug('error', `Error processing panel ${i + 1}: ${error.message}`);
                expandedPanels.push(panel); // Include it anyway
            }
        }
        
        sendDebug('success', `Processed ${expandedPanels.length} trip panels`);
        return expandedPanels;
    }

    async function waitForExpansionContent(panel) {
        sendDebug('info', 'Waiting for expansion content to load...');
        
        // Wait up to 5 seconds for expansion content to appear
        for (let i = 0; i < 10; i++) {
            const hasContent = panel.querySelector('.view, .modify, .cancel, [href*="modify"], [href*="view"], .confirmation, [class*="confirmation"]');
            
            if (hasContent) {
                sendDebug('success', `Expansion content appeared after ${i * 500}ms`);
                return;
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        sendDebug('warning', 'Expansion content not detected after 5 seconds, proceeding anyway');
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
