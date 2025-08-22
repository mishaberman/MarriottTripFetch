document.addEventListener('DOMContentLoaded', function() {
    const extractBtn = document.getElementById('extractBtn');
    const clearBtn = document.getElementById('clearBtn');
    const exportBtn = document.getElementById('exportBtn');
    const clearDebugBtn = document.getElementById('clearDebugBtn');
    const statusEl = document.getElementById('status');
    const progressSection = document.getElementById('progressSection');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const reservationsList = document.getElementById('reservationsList');
    const debugSection = document.getElementById('debugSection');
    const debugLog = document.getElementById('debugLog');

    // Load existing reservations on popup open
    loadReservations();

    // Extract reservations button
    extractBtn.addEventListener('click', async function() {
        try {
            // Check if we're on a Marriott page
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const currentTab = tabs[0];
            
            if (!currentTab.url.includes('marriott.com')) {
                showError('Please navigate to marriott.com first and log into your account.');
                return;
            }

            extractBtn.disabled = true;
            setStatus('working', 'Extracting...');
            showProgress(true);
            updateProgress(0, 'Starting extraction process...');

            // Send message to content script to start extraction
            chrome.tabs.sendMessage(currentTab.id, { action: 'startExtraction' }, (response) => {
                if (chrome.runtime.lastError) {
                    showError('Failed to communicate with Marriott page. Please refresh the page and try again.');
                    resetUI();
                    return;
                }
            });

        } catch (error) {
            console.error('Error starting extraction:', error);
            showError('Failed to start extraction: ' + error.message);
            resetUI();
        }
    });

    // Clear data button
    clearBtn.addEventListener('click', function() {
        if (confirm('Are you sure you want to clear all extracted reservation data?')) {
            chrome.storage.local.clear(() => {
                loadReservations();
                setStatus('ready', 'Ready');
            });
        }
    });

    // Export data button
    exportBtn.addEventListener('click', async function() {
        const data = await getStoredReservations();
        if (data.length === 0) {
            showError('No reservations to export.');
            return;
        }

        const jsonData = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `marriott-reservations-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // Clear debug log button
    clearDebugBtn.addEventListener('click', function() {
        debugLog.innerHTML = '';
        debugSection.style.display = 'none';
    });

    // Listen for messages from content script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.action) {
            case 'progress':
                updateProgress(message.percent, message.text);
                break;
            case 'extractionComplete':
                handleExtractionComplete(message.data);
                break;
            case 'extractionError':
                showError(message.error);
                resetUI();
                break;
            case 'debug':
                addDebugEntry(message.type || 'info', message.message);
                break;
        }
    });

    function setStatus(type, text) {
        statusEl.textContent = text;
        statusEl.className = `status ${type}`;
    }

    function showProgress(show) {
        progressSection.style.display = show ? 'block' : 'none';
    }

    function updateProgress(percent, text) {
        progressFill.style.width = percent + '%';
        progressText.textContent = text;
    }

    function showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        
        // Remove existing error messages
        const existingErrors = document.querySelectorAll('.error-message');
        existingErrors.forEach(err => err.remove());
        
        // Insert error message after status section
        const statusSection = document.querySelector('.status-section');
        statusSection.insertAdjacentElement('afterend', errorDiv);
        
        // Remove error message after 10 seconds
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.remove();
            }
        }, 10000);
    }

    function resetUI() {
        extractBtn.disabled = false;
        setStatus('ready', 'Ready');
        showProgress(false);
    }

    function handleExtractionComplete(reservations) {
        if (reservations && reservations.length > 0) {
            setStatus('success', `Found ${reservations.length} reservation(s)`);
            loadReservations();
        } else {
            setStatus('ready', 'No upcoming reservations found');
        }
        extractBtn.disabled = false;
        showProgress(false);
    }

    async function loadReservations() {
        const reservations = await getStoredReservations();
        displayReservations(reservations);
    }

    function getStoredReservations() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['reservations'], (result) => {
                resolve(result.reservations || []);
            });
        });
    }

    function displayReservations(reservations) {
        reservationsList.innerHTML = '';

        if (reservations.length === 0) {
            reservationsList.innerHTML = `
                <div class="empty-state">
                    <p>No reservations extracted yet. Click "Extract Reservations" to begin.</p>
                </div>
            `;
            return;
        }

        // Sort reservations by check-in date
        reservations.sort((a, b) => {
            const dateA = new Date(a.checkInDate || '1970-01-01');
            const dateB = new Date(b.checkInDate || '1970-01-01');
            return dateA - dateB;
        });

        reservations.forEach(reservation => {
            const card = createReservationCard(reservation);
            reservationsList.appendChild(card);
        });
    }

    function createReservationCard(reservation) {
        const card = document.createElement('div');
        card.className = 'reservation-card';

        const header = document.createElement('div');
        header.className = 'reservation-header';

        const hotelName = document.createElement('div');
        hotelName.className = 'hotel-name';
        hotelName.textContent = reservation.hotelName || 'Hotel Name Not Found';

        const confirmationNumber = document.createElement('div');
        confirmationNumber.className = 'confirmation-number';
        confirmationNumber.textContent = reservation.confirmationNumber || 'N/A';

        header.appendChild(hotelName);
        header.appendChild(confirmationNumber);

        const details = document.createElement('div');
        details.className = 'reservation-details';

        // Date range
        if (reservation.checkInDate && reservation.checkOutDate) {
            const dateRange = document.createElement('div');
            dateRange.className = 'date-range';
            dateRange.textContent = `${formatDate(reservation.checkInDate)} - ${formatDate(reservation.checkOutDate)}`;
            details.appendChild(dateRange);
        }

        // Details grid
        const detailItems = [
            { label: 'Total Cost', value: reservation.totalCost || 'N/A' },
            { label: 'Nights', value: reservation.nights || 'N/A' },
            { label: 'Avg/Night', value: reservation.pricePerNight || 'N/A' },
            { label: 'Points Used', value: reservation.pointsUsed || 'None' },
            { label: 'Promo Code', value: reservation.promoCode || 'None' },
            { label: 'Room Type', value: reservation.roomType || 'N/A' }
        ];

        detailItems.forEach(item => {
            const detailItem = document.createElement('div');
            detailItem.className = 'detail-item';
            
            const label = document.createElement('span');
            label.className = 'detail-label';
            label.textContent = item.label + ':';
            
            const value = document.createElement('span');
            value.className = 'detail-value';
            value.textContent = item.value;
            
            detailItem.appendChild(label);
            detailItem.appendChild(value);
            details.appendChild(detailItem);
        });

        card.appendChild(header);
        card.appendChild(details);

        return card;
    }

    function formatDate(dateString) {
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric',
                year: 'numeric'
            });
        } catch (error) {
            return dateString;
        }
    }

    function addDebugEntry(type, message) {
        debugSection.style.display = 'block';
        
        const entry = document.createElement('div');
        entry.className = `debug-entry ${type}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        
        debugLog.appendChild(entry);
        debugLog.scrollTop = debugLog.scrollHeight;
        
        // Limit to 100 entries
        const entries = debugLog.children;
        if (entries.length > 100) {
            debugLog.removeChild(entries[0]);
        }
    }
});
