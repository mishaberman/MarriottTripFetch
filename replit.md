# Overview

Marriott Trip Extractor is a Chrome browser extension that automatically extracts reservation details from a user's logged-in Marriott account. The extension provides a convenient popup interface for initiating the extraction process and displaying upcoming reservations in a user-friendly format. It works by injecting content scripts into Marriott website pages to scrape reservation data and store it locally for easy access and export.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Chrome Extension Architecture
The extension follows the Manifest V3 architecture with three main components:
- **Background Service Worker** (`background.js`): Handles extension lifecycle, message routing between components, and automatic content script injection
- **Content Script** (`content.js`): Injected into Marriott pages to perform DOM scraping and reservation data extraction
- **Popup Interface** (`popup.html/js/css`): Provides user interaction interface for triggering extractions and viewing results

## Data Flow Pattern
The system uses a message-passing architecture where:
1. User initiates extraction through popup interface
2. Popup sends message to content script via background worker
3. Content script navigates Marriott pages and extracts reservation data
4. Progress updates are sent back through the message chain to update UI
5. Extracted data is stored in Chrome's local storage

## User Interface Design
The popup interface uses a clean, responsive design with:
- Status indicators showing extraction progress
- Real-time progress bar with descriptive text
- Reservation display cards for viewing extracted data
- Action buttons for data management (clear, export)

## Data Extraction Strategy
The content script employs:
- DOM element detection with multiple selector fallbacks
- Asynchronous navigation and page loading handling
- Login status verification before extraction attempts
- Error handling with user-friendly feedback

## Data Storage Solution
Uses Chrome's built-in `chrome.storage.local` API for:
- Persistent storage of extracted reservation data
- Cross-session data persistence
- Secure local storage without external dependencies

# External Dependencies

## Chrome Extension APIs
- **chrome.runtime**: Message passing, extension lifecycle management
- **chrome.tabs**: Tab management and content script injection
- **chrome.scripting**: Dynamic content script execution
- **chrome.storage**: Local data persistence

## Target Website Integration
- **Marriott.com domains**: Primary extraction target across multiple regional domains (.com, .co.uk, .ca)
- **Authentication dependency**: Requires user to be logged into Marriott account
- **DOM structure dependency**: Relies on Marriott's HTML structure for reservation elements

## Browser Compatibility
- **Manifest V3**: Modern Chrome extension standard
- **Service Worker**: Background processing without persistent background pages
- **Modern JavaScript**: Uses async/await patterns and modern DOM APIs