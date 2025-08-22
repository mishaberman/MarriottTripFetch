// Background service worker for Marriott Trip Extractor
chrome.runtime.onInstalled.addListener(() => {
    console.log('Marriott Trip Extractor installed');
});

// Handle messages between popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Forward progress messages from content script to popup
    if (message.action === 'progress' || 
        message.action === 'extractionComplete' || 
        message.action === 'extractionError' ||
        message.action === 'debug') {
        
        // Broadcast to all popup instances
        chrome.runtime.sendMessage(message).catch(() => {
            // Ignore errors if no popup is listening
        });
    }
    
    // Send response to avoid connection errors
    if (sendResponse) {
        sendResponse({ received: true });
    }
});

// Handle tab updates to inject content script if needed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && 
        tab.url && 
        tab.url.includes('marriott.com')) {
        
        // Ensure content script is injected
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        }).catch((error) => {
            // Content script might already be injected - ignore error
            console.log('Content script injection skipped:', error.message);
        });
    }
});

// Clear any caching to improve popup loading speed
chrome.runtime.onStartup.addListener(() => {
    // Clear any cached data that might slow down popup
    chrome.storage.local.get(null, (items) => {
        if (Object.keys(items).length > 100) {
            // If too much cached data, clear old items
            chrome.storage.local.clear();
        }
    });
});
