# Overview

This is an Arm Swing Dashboard application that visualizes sensor data from LOLIN D32 devices equipped with dual MPU6050 sensors. The system tracks arm swing movements for both left and right arms, collecting data on swing counts, distances, and motion patterns. The Flask web application serves as a dashboard that connects to a Google Apps Script endpoint to fetch and display real-time sensor data through interactive charts and comprehensive session statistics.

## Recent Changes (August 16, 2025)
- Successfully connected dashboard to real Google Sheets sensor data
- Updated Google Apps Script with both read and write functions for proper data retrieval
- Fixed session duration calculation to use actual data timespan instead of browser session time
- Corrected average swing rate calculation from unrealistic 24,944/min to proper 4.5/min
- Removed all data filtering limitations to display complete sensor data
- Updated Apps Script URL to new deployment: AKfycbzBvJKEtq9sOr6JkIPRjNUf_4xROrjfYzzAtlElzlUsUg69tv45QoupNosSsXKZQs7l
- Dashboard now shows realistic statistics: 1,189 total swings over 4h 22m session
- Confirmed proper data flow from ESP32 → Google Sheets → Apps Script → Dashboard
- All 12 statistics displaying correctly with real sensor measurements
- Project successfully completed and fully functional

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Template Engine**: Uses Flask's Jinja2 templating with Bootstrap 5 for responsive UI components
- **Visualization**: Chart.js library for rendering interactive time-series charts and statistics
- **Styling**: Bootstrap CSS framework with custom CSS for enhanced visual styling and hover effects
- **Client-Side Logic**: Vanilla JavaScript class-based architecture for dashboard management, auto-refresh functionality, and data fetching

## Backend Architecture
- **Web Framework**: Flask application with modular route structure
- **CORS Proxy**: Server acts as a proxy to avoid CORS issues when fetching data from Google Apps Script
- **Session Management**: Uses Flask sessions with configurable secret key from environment variables
- **Request Handling**: RESTful API endpoint (`/api/data`) that forwards requests to Google Apps Script
- **Error Handling**: Comprehensive logging and error handling for external API communication

## Data Flow Architecture
- **ESP32 Sensors**: Dual MPU6050 sensors on each arm collect gyroscope and accelerometer data
- **Data Processing**: ESP32 processes raw sensor data to calculate swing counts, distances, and motion patterns
- **Data Storage**: Google Sheets serves as the database, managed through Google Apps Script
- **Web Dashboard**: Flask application fetches data via Google Apps Script API and presents it through interactive visualizations

## Configuration Management
- **Environment Variables**: Uses environment-based configuration for session secrets and API endpoints
- **Client-Side Storage**: localStorage for persisting user preferences like custom script URLs
- **Default Endpoints**: Hardcoded fallback Google Apps Script URL for immediate functionality

# External Dependencies

## Hardware Integration
- **ESP32 Microcontroller**: Primary sensor platform with WiFi connectivity
- **MPU6050 Sensors**: Dual gyroscope/accelerometer sensors for motion detection
- **Adafruit Libraries**: Hardware abstraction layer for sensor communication

## Google Services
- **Google Apps Script**: Server-side JavaScript platform hosting the data API endpoint
- **Google Sheets**: Cloud-based spreadsheet serving as the primary data storage
- **Spreadsheet ID**: `1r8YL1tRy92l9zRJQ5srRHxJA6X8qn9mln82LM-MVTVQ` for data persistence

## Python Dependencies
- **Flask**: Web framework for serving the dashboard application
- **Werkzeug**: WSGI utilities including ProxyFix for deployment compatibility
- **Requests**: HTTP library for communicating with Google Apps Script endpoints

## Frontend Libraries
- **Bootstrap 5**: CSS framework for responsive design and UI components
- **Chart.js**: JavaScript charting library for data visualization
- **Font Awesome**: Icon library for enhanced UI elements
- **Google Fonts**: Inter font family for improved typography

## Network Requirements
- **WiFi Connectivity**: ESP32 requires network access to transmit sensor data
- **HTTPS Endpoints**: Secure communication with Google Apps Script APIs
- **CORS Handling**: Server-side proxy to manage cross-origin requests from the dashboard