// Dashboard JavaScript for Arm Swing Visualization
class ArmSwingDashboard {
    constructor() {
        this.charts = {};
        this.data = [];
        this.refreshInterval = null;
        this.REFRESH_INTERVAL_MS = 150000; // 2.5 minutes
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.initializeCharts();
        this.loadStoredConfig();
        this.startAutoRefresh();
        this.fetchData(); // Initial load
    }
    
    setupEventListeners() {
        document.getElementById('refresh-btn').addEventListener('click', () => {
            this.fetchData();
        });
        
        document.getElementById('script-url').addEventListener('change', (e) => {
            localStorage.setItem('armswing_script_url', e.target.value);
        });
    }
    
    loadStoredConfig() {
        const storedUrl = localStorage.getItem('armswing_script_url');
        if (storedUrl) {
            document.getElementById('script-url').value = storedUrl;
        }
    }
    
    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        
        this.refreshInterval = setInterval(() => {
            this.fetchData();
        }, this.REFRESH_INTERVAL_MS);
    }
    
    updateConnectionStatus(status, message) {
        const statusEl = document.getElementById('connection-status');
        statusEl.className = 'badge';
        
        switch(status) {
            case 'connected':
                statusEl.classList.add('bg-success');
                statusEl.innerHTML = '<i class="fas fa-circle me-1"></i>Connected';
                break;
            case 'error':
                statusEl.classList.add('bg-danger');
                statusEl.innerHTML = '<i class="fas fa-exclamation-circle me-1"></i>Error';
                break;
            case 'loading':
                statusEl.classList.add('bg-warning');
                statusEl.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Loading...';
                break;
            default:
                statusEl.classList.add('bg-secondary');
                statusEl.innerHTML = '<i class="fas fa-circle me-1"></i>Disconnected';
        }
    }
    
    async fetchData() {
        try {
            this.updateConnectionStatus('loading');
            
            const scriptUrl = document.getElementById('script-url').value;
            const apiUrl = `/api/data?limit=200${scriptUrl ? `&url=${encodeURIComponent(scriptUrl)}` : ''}`;
            
            const response = await fetch(apiUrl);
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            
            if (result.error) {
                throw new Error(result.error);
            }
            
            const rawData = result.data || [];
            this.data = this.validateAndCleanData(rawData);
            
            if (rawData.length > 0 && this.data.length === 0) {
                this.updateConnectionStatus('warning', 'Test data detected');
                this.showToast('Only test data found. Using demo mode for visualization.', 'warning');
                this.data = this.generateDemoData();
                this.showDemoBadge(true);
            } else if (this.data.length === 0) {
                this.updateConnectionStatus('warning', 'No data');
                this.showToast('No sensor data available. Using demo mode for visualization.', 'info');
                this.data = this.generateDemoData();
                this.showDemoBadge(true);
            } else {
                this.updateConnectionStatus('connected');
                this.showDemoBadge(false);
            }
            
            this.updateDashboard();
            
            document.getElementById('last-update').textContent = new Date().toLocaleString();
            
        } catch (error) {
            console.error('Error fetching data:', error);
            this.updateConnectionStatus('error', error.message);
            this.showError(`Failed to fetch data: ${error.message}`);
        }
    }
    
    showError(message) {
        console.error(message);
        this.showToast(message, 'danger');
    }
    
    showToast(message, type = 'info') {
        // Create toast container if it doesn't exist
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.className = 'position-fixed top-0 end-0 p-3';
            toastContainer.style.zIndex = '1050';
            document.body.appendChild(toastContainer);
        }
        
        // Create toast element
        const toastId = 'toast-' + Date.now();
        const toastHtml = `
            <div class="toast align-items-center text-white bg-${type} border-0" role="alert" id="${toastId}">
                <div class="d-flex">
                    <div class="toast-body">
                        ${message}
                    </div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
                </div>
            </div>
        `;
        
        toastContainer.insertAdjacentHTML('beforeend', toastHtml);
        
        // Initialize and show toast
        const toastElement = document.getElementById(toastId);
        const toast = new bootstrap.Toast(toastElement, { delay: 5000 });
        toast.show();
        
        // Remove toast element after it's hidden
        toastElement.addEventListener('hidden.bs.toast', () => {
            toastElement.remove();
        });
    }
    
    showDemoBadge(show) {
        const demoBadge = document.getElementById('demo-badge');
        if (demoBadge) {
            demoBadge.style.display = show ? 'inline' : 'none';
        }
    }
    
    updateDashboard() {
        this.updateStats();
        this.updateCharts();
        this.updateTable();
    }
    
    updateStats() {
        if (this.data.length === 0) {
            this.clearStats();
            return;
        }
        
        // Calculate cumulative totals across all data points
        const totalLeftCount = this.data.reduce((sum, d) => sum + (d.leftCount || 0), 0);
        const totalRightCount = this.data.reduce((sum, d) => sum + (d.rightCount || 0), 0);
        const totalLeftDistance = this.data.reduce((sum, d) => sum + (d.leftDistance || 0), 0);
        const totalRightDistance = this.data.reduce((sum, d) => sum + (d.rightDistance || 0), 0);
        
        const totalDistance = totalLeftDistance + totalRightDistance;
        const totalCount = totalLeftCount + totalRightCount;
        const leftShare = totalDistance > 0 ? (totalLeftDistance / totalDistance * 100) : 50;
        const rightShare = totalDistance > 0 ? (totalRightDistance / totalDistance * 100) : 50;
        
        // Calculate session duration
        let sessionDuration = '-';
        if (this.data.length > 1) {
            const firstTime = new Date(this.data[0].timestamp);
            const lastTime = new Date(this.data[this.data.length - 1].timestamp);
            const durationMs = lastTime - firstTime;
            const minutes = Math.floor(durationMs / 60000);
            const seconds = Math.floor((durationMs % 60000) / 1000);
            sessionDuration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
        
        // Calculate average swing rate per minute
        let avgRate = 0;
        if (this.data.length > 1) {
            const firstTime = new Date(this.data[0].timestamp);
            const lastTime = new Date(this.data[this.data.length - 1].timestamp);
            const durationMinutes = (lastTime - firstTime) / 60000;
            avgRate = durationMinutes > 0 ? totalCount / durationMinutes : 0;
        }
        
        // Calculate balance score (100 = perfect balance, lower = more imbalanced)
        const balanceScore = totalDistance > 0 ? (100 - Math.abs(50 - leftShare) * 2) : 100;
        
        // Update all stats
        document.getElementById('stat-left-count').textContent = totalLeftCount;
        document.getElementById('stat-right-count').textContent = totalRightCount;
        document.getElementById('stat-left-distance').textContent = totalLeftDistance.toFixed(1);
        document.getElementById('stat-right-distance').textContent = totalRightDistance.toFixed(1);
        document.getElementById('stat-total-distance').textContent = totalDistance.toFixed(1);
        document.getElementById('stat-left-share').textContent = leftShare.toFixed(1);
        document.getElementById('stat-right-share').textContent = rightShare.toFixed(1);
        document.getElementById('stat-total-count').textContent = totalCount;
        document.getElementById('stat-session-duration').textContent = sessionDuration;
        document.getElementById('stat-avg-rate').textContent = avgRate.toFixed(1);
        document.getElementById('stat-balance-score').textContent = balanceScore.toFixed(0);
        document.getElementById('stat-data-points').textContent = this.data.length;
    }
    
    clearStats() {
        ['stat-left-count', 'stat-right-count', 'stat-left-distance', 
         'stat-right-distance', 'stat-total-distance', 'stat-left-share',
         'stat-right-share', 'stat-total-count', 'stat-session-duration',
         'stat-avg-rate', 'stat-balance-score', 'stat-data-points'].forEach(id => {
            document.getElementById(id).textContent = '-';
        });
    }
    
    initializeCharts() {
        // Distance Trends Chart
        this.charts.distance = new Chart(document.getElementById('distance-chart'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Left Distance (cm)',
                    data: [],
                    borderColor: '#007bff',
                    backgroundColor: 'rgba(0, 123, 255, 0.1)',
                    tension: 0.4
                }, {
                    label: 'Right Distance (cm)',
                    data: [],
                    borderColor: '#28a745',
                    backgroundColor: 'rgba(40, 167, 69, 0.1)',
                    tension: 0.4
                }]
            },
            options: this.getChartOptions('Distance (cm)')
        });
        
        // Count Chart
        this.charts.count = new Chart(document.getElementById('count-chart'), {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'Left Count',
                    data: [],
                    backgroundColor: '#007bff'
                }, {
                    label: 'Right Count',
                    data: [],
                    backgroundColor: '#28a745'
                }]
            },
            options: this.getChartOptions('Count')
        });
        
        // Balance Chart
        this.charts.balance = new Chart(document.getElementById('balance-chart'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Left Share (%)',
                    data: [],
                    borderColor: '#17a2b8',
                    backgroundColor: 'rgba(23, 162, 184, 0.1)',
                    tension: 0.4
                }]
            },
            options: {
                ...this.getChartOptions('Percentage (%)'),
                scales: {
                    y: {
                        min: 0,
                        max: 100,
                        ticks: {
                            callback: function(value) {
                                return value + '%';
                            }
                        }
                    }
                }
            }
        });
        
        // Summary Pie Chart
        this.charts.summary = new Chart(document.getElementById('summary-chart'), {
            type: 'doughnut',
            data: {
                labels: ['Left Distance', 'Right Distance'],
                datasets: [{
                    data: [0, 0],
                    backgroundColor: ['#007bff', '#28a745']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });
        
        // Fluctuation Chart
        this.charts.fluctuation = new Chart(document.getElementById('fluctuation-chart'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Fluctuation (σ)',
                    data: [],
                    borderColor: '#dc3545',
                    backgroundColor: 'rgba(220, 53, 69, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: this.getChartOptions('Standard Deviation')
        });
    }
    
    getChartOptions(yAxisLabel) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Time'
                    }
                },
                y: {
                    display: true,
                    title: {
                        display: true,
                        text: yAxisLabel
                    },
                    beginAtZero: true
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                }
            }
        };
    }
    
    updateCharts() {
        if (this.data.length === 0) return;
        
        // Get last 50 data points for main charts
        const recentData = this.data.slice(-50);
        const labels = recentData.map(d => {
            const date = new Date(d.timestamp);
            return date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        });
        
        // Update distance chart
        this.charts.distance.data.labels = labels;
        this.charts.distance.data.datasets[0].data = recentData.map(d => d.leftDistance || 0);
        this.charts.distance.data.datasets[1].data = recentData.map(d => d.rightDistance || 0);
        this.charts.distance.update();
        
        // Update count chart
        this.charts.count.data.labels = labels;
        this.charts.count.data.datasets[0].data = recentData.map(d => d.leftCount || 0);
        this.charts.count.data.datasets[1].data = recentData.map(d => d.rightCount || 0);
        this.charts.count.update();
        
        // Update balance chart
        const balanceData = recentData.map(d => {
            const total = (d.leftDistance || 0) + (d.rightDistance || 0);
            return total > 0 ? ((d.leftDistance || 0) / total * 100) : 50;
        });
        this.charts.balance.data.labels = labels;
        this.charts.balance.data.datasets[0].data = balanceData;
        this.charts.balance.update();
        
        // Update summary chart with total session data
        const totalLeft = this.data.reduce((sum, d) => sum + (d.leftDistance || 0), 0);
        const totalRight = this.data.reduce((sum, d) => sum + (d.rightDistance || 0), 0);
        this.charts.summary.data.datasets[0].data = [totalLeft, totalRight];
        this.charts.summary.update();
        
        // Update fluctuation chart with 2.5-minute windows
        this.updateFluctuationChart();
    }
    
    updateFluctuationChart() {
        if (this.data.length < 10) return; // Need minimum data
        
        // Group data into 2.5-minute windows (approximately 15 data points per window)
        const windowSize = 15;
        const windows = [];
        const fluctuations = [];
        const windowLabels = [];
        
        for (let i = 0; i < this.data.length; i += windowSize) {
            const window = this.data.slice(i, i + windowSize);
            if (window.length >= 5) { // Minimum 5 points for meaningful std dev
                const totalDistances = window.map(d => (d.leftDistance || 0) + (d.rightDistance || 0));
                const stdDev = this.calculateStandardDeviation(totalDistances);
                
                fluctuations.push(stdDev);
                
                // Use the timestamp of the middle point in the window
                const midPoint = window[Math.floor(window.length / 2)];
                const date = new Date(midPoint.timestamp);
                windowLabels.push(date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}));
            }
        }
        
        this.charts.fluctuation.data.labels = windowLabels;
        this.charts.fluctuation.data.datasets[0].data = fluctuations;
        this.charts.fluctuation.update();
    }
    
    calculateStandardDeviation(values) {
        if (values.length <= 1) return 0;
        
        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        const squareDiffs = values.map(val => Math.pow(val - mean, 2));
        const avgSquareDiff = squareDiffs.reduce((sum, val) => sum + val, 0) / values.length;
        
        return Math.sqrt(avgSquareDiff);
    }
    
    generateDemoData() {
        const data = [];
        const now = new Date();
        
        // Generate 50 data points spanning the last 30 minutes
        for (let i = 49; i >= 0; i--) {
            const timestamp = new Date(now.getTime() - i * 30000); // 30 seconds apart
            
            // Generate realistic arm swing data with some variation
            const baseLeftCount = Math.floor(Math.random() * 8) + 2; // 2-10 swings
            const baseRightCount = Math.floor(Math.random() * 8) + 2;
            
            const leftDistance = baseLeftCount * (15 + Math.random() * 10); // 15-25 cm per swing
            const rightDistance = baseRightCount * (15 + Math.random() * 10);
            
            data.push({
                timestamp: timestamp.toISOString(),
                leftCount: baseLeftCount,
                rightCount: baseRightCount,
                leftDistance: Math.round(leftDistance * 10) / 10, // Round to 1 decimal
                rightDistance: Math.round(rightDistance * 10) / 10
            });
        }
        
        return data;
    }
    
    validateAndCleanData(rawData) {
        return rawData.filter(d => {
            // Filter out test data and invalid entries
            if (!d.timestamp) return false;
            
            // Check if timestamp is actually a name (Korean characters or obvious test values)
            const timestamp = String(d.timestamp).trim();
            if (timestamp === 'name' || timestamp.includes('테스트') || 
                /^[가-힣]{2,}$/.test(timestamp) || // Korean names
                timestamp.length < 8) { // Too short to be a real timestamp
                return false;
            }
            
            // Check for obviously fake data (extremely high values that don't make sense for arm swings)
            const leftCount = Number(d.leftCount) || 0;
            const rightCount = Number(d.rightCount) || 0;
            const leftDistance = Number(d.leftDistance) || 0;
            const rightDistance = Number(d.rightDistance) || 0;
            
            // Reasonable limits for arm swing data
            if (leftCount > 1000 || rightCount > 1000 || 
                leftDistance > 1000 || rightDistance > 1000) {
                return false;
            }
            
            return true;
        }).map(d => {
            // Ensure timestamp is a valid date
            let timestamp = d.timestamp;
            const parsedDate = new Date(timestamp);
            if (isNaN(parsedDate.getTime())) {
                // If timestamp is invalid, use current time
                timestamp = new Date().toISOString();
            }
            
            return {
                ...d,
                timestamp: timestamp,
                leftCount: Math.max(0, Number(d.leftCount) || 0),
                rightCount: Math.max(0, Number(d.rightCount) || 0),
                leftDistance: Math.max(0, Number(d.leftDistance) || 0),
                rightDistance: Math.max(0, Number(d.rightDistance) || 0)
            };
        });
    }

    updateTable() {
        const tbody = document.getElementById('data-table-body');
        
        if (this.data.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center text-muted">
                        <i class="fas fa-info-circle me-2"></i>
                        No valid sensor data available - only test data found
                    </td>
                </tr>
            `;
            return;
        }
        
        // Show last 20 records
        const recentData = this.data.slice(-20).reverse();
        
        tbody.innerHTML = recentData.map(d => {
            const totalDistance = (d.leftDistance || 0) + (d.rightDistance || 0);
            const leftShare = totalDistance > 0 ? ((d.leftDistance || 0) / totalDistance * 100) : 0;
            
            let timestampDisplay;
            const parsedDate = new Date(d.timestamp);
            if (isNaN(parsedDate.getTime())) {
                timestampDisplay = 'Invalid Date';
            } else {
                timestampDisplay = parsedDate.toLocaleString();
            }
            
            return `
                <tr>
                    <td>${timestampDisplay}</td>
                    <td>${d.leftCount || 0}</td>
                    <td>${d.rightCount || 0}</td>
                    <td>${(d.leftDistance || 0).toFixed(1)}</td>
                    <td>${(d.rightDistance || 0).toFixed(1)}</td>
                    <td>${totalDistance.toFixed(1)}</td>
                    <td>${leftShare.toFixed(1)}%</td>
                </tr>
            `;
        }).join('');
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ArmSwingDashboard();
});
