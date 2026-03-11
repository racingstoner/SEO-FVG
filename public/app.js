document.addEventListener('DOMContentLoaded', () => {
    // --- Tabs Logic ---
    const tabLinks = document.querySelectorAll('#tab-nav li');
    const tabPanes = document.querySelectorAll('.tab-pane');
    const topbarTitle = document.getElementById('topbar-title');
    
    tabLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Remove active from all tabs
            tabLinks.forEach(l => l.classList.remove('active'));
            tabPanes.forEach(p => {
                p.classList.remove('active');
                p.style.display = 'none';
            });
            
            // Add active to current
            link.classList.add('active');
            const targetId = link.getAttribute('data-target');
            const targetPane = document.getElementById(`tab-${targetId}`);
            
            if (targetPane) {
                targetPane.classList.add('active');
                targetPane.style.display = 'block';
            }
            
            // Update Title
            topbarTitle.innerText = link.innerText;
        });
    });

    // --- Spreadsheet Analysis Logic ---
    const analyzeBtn = document.getElementById('analyze-btn');
    const stopBtn = document.getElementById('stop-btn');
    const sheetUrlInput = document.getElementById('sheet-url');
    const statusMessage = document.getElementById('status-message');
    const progressEl = document.getElementById('progress-indicator');
    
    // Dashboard elements
    const dashboard = document.getElementById('dashboard');
    const totalUrlsEl = document.getElementById('total-urls');
    const lastUpdatedEl = document.getElementById('last-updated');
    const statusCodesSummaryEl = document.getElementById('status-codes-summary');
    const outOfStockEl = document.getElementById('out-of-stock');
    
    // Table elements
    const tableContainer = document.getElementById('table-container');
    const tableBody = document.getElementById('table-body');
    const thElements = document.querySelectorAll('th[data-sort]');
    const exportCsvBtn = document.getElementById('export-csv');

    // Pagination elements
    const paginationContainer = document.createElement('div');
    paginationContainer.className = 'pagination';
    tableContainer.appendChild(paginationContainer);

    let isPolling = false;
    let pollInterval = null;
    let urlData = []; // To keep for sorting
    
    // Pagination state
    let currentPage = 1;
    const rowsPerPage = 15;
    
    // Sorting state
    let sortCol = '';
    let sortAsc = true;

    analyzeBtn.addEventListener('click', startAnalysis);
    stopBtn.addEventListener('click', stopAnalysis);
    
    thElements.forEach(th => {
        th.addEventListener('click', () => handleSort(th.dataset.sort));
    });
    
    exportCsvBtn.addEventListener('click', exportCSV);

    const sheetNextUpdate = document.getElementById('sheet-next-update');
    
    async function fetchNextUpdate() {
        if (!sheetNextUpdate) return;
        try {
            const response = await fetch(`/api/spreadsheet-next-update`);
            const data = await response.json();
            if (data.success) {
                const parts = data.nextUpdateBA.split(' '); 
                let html = '';
                if (parts.length >= 2) {
                    html = `${parts[0]}<br><span class="time-small">${parts[1]} hs</span>`;
                } else {
                    html = data.nextUpdateBA;
                }
                
                let countdownStr = "En ";
                if (data.hoursLeft > 0) countdownStr += `${data.hoursLeft}h `;
                countdownStr += `${data.minutesLeft}m`;
                
                sheetNextUpdate.innerHTML = `${html}<br><span class="time-small" style="color: var(--warning); font-weight: bold;">(Faltan: ${countdownStr})</span>`;
            }
        } catch (e) {
            console.error("fetchNextUpdate error", e);
        }
    }
    
    fetchNextUpdate();
    setInterval(fetchNextUpdate, 60000);

    async function startAnalysis() {
        const urlStr = sheetUrlInput.value.trim();
        if (!urlStr) return;

        let sheetId = "";
        const match = urlStr.match(/\/d\/(.*?)(\/|$)/);
        if (match && match[1]) {
            sheetId = match[1];
        } else {
            alert("URL Inválida. No se pudo encontrar el ID del spreadsheet.");
            return;
        }

        // Reset UI
        analyzeBtn.style.display = 'none';
        dashboard.style.display = 'grid';
        tableContainer.style.display = 'block';
        tableBody.innerHTML = '';
        statusCodesSummaryEl.innerHTML = '';
        statusMessage.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Obteniendo y guardando URLs desde Google Sheets...';
        currentPage = 1;
        urlData = [];
        
        try {
            const response = await fetch(`/api/spreadsheet?id=${encodeURIComponent(sheetId)}`);
            const data = await response.json();
            
            if (data.error) throw new Error(data.error);
            
            setTimeout(() => {
                startPolling();
            }, 1000);

        } catch (error) {
            statusMessage.innerHTML = `<i class="fas fa-times-circle" style="color: var(--danger)"></i> Error: ${error.message}`;
            analyzeBtn.style.display = 'flex';
        }
    }
    
    function startPolling() {
        if (isPolling) return;
        isPolling = true;
        
        dashboard.style.display = 'grid';
        tableContainer.style.display = 'block';
        analyzeBtn.style.display = 'none';
        stopBtn.style.display = 'flex';
        
        // Polling loop logic
        function loadData() {
            fetchProgress().then(stillProcessing => {
                if (!stillProcessing && isPolling) {
                    // Check if it's REALLY totally done or just paused
                    statusMessage.innerHTML = '<i class="fas fa-check-circle" style="color: var(--success)"></i> Análisis completado (Guardado en Base de Datos).';
                    stopPolling();
                } else if (isPolling) {
                    pollInterval = setTimeout(loadData, 3000); // Queue next pull
                }
            }).catch(() => {
                if (isPolling) pollInterval = setTimeout(loadData, 5000);
            });
        }
        
        loadData(); 
    }
    
    async function stopAnalysis() {
        if (!isPolling) return;
        
        statusMessage.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Solicitando detención al servidor...';
        stopBtn.disabled = true;
        
        try {
            await fetch(`/api/stop`);
            // El próximo polling se dará cuenta de que el server paró y actualizará el UI
        } catch(e) {
            console.error("Error stopping", e);
        }
    }
    
    function stopPolling() {
        isPolling = false;
        if (pollInterval) clearTimeout(pollInterval);
        analyzeBtn.style.display = 'flex';
        stopBtn.style.display = 'none';
        stopBtn.disabled = false;
    }

    async function fetchProgress() {
        try {
            const response = await fetch(`/api/progress`);
            const data = await response.json();
            
            const stats = data.stats;
            urlData = data.urls;
            
            // Update Dashboard
            totalUrlsEl.textContent = stats.total;
            if (stats.lastUpdated && stats.lastUpdated !== '-') {
                const parts = stats.lastUpdated.split(' '); 
                if (parts.length >= 2) {
                    lastUpdatedEl.innerHTML = `${parts[0]}<br><span class="time-small">${parts[1]}</span>`;
                } else {
                    lastUpdatedEl.textContent = stats.lastUpdated;
                }
            } else {
                lastUpdatedEl.textContent = '-';
            }
            outOfStockEl.textContent = stats.outOfStock;
            
            // Update Status Codes indicators
            let statusHtml = '';
            for (const [group, count] of Object.entries(stats.statusCodes)) {
                let badgeClass = 'badge';
                if (group === '2xx') badgeClass += ' b-200';
                else if (group === '3xx') badgeClass += ' b-404'; // yellow
                else if (group === '4xx') badgeClass += ' b-404'; // yellow
                else if (group === '5xx') badgeClass += ' b-500'; // red
                
                statusHtml += `<span class="${badgeClass}">${group}: ${count}</span>`;
            }
            statusCodesSummaryEl.innerHTML = statusHtml || '-';
            
            // Update Progress Tracking
            let progress = 0;
            if (stats.total > 0) {
                progress = Math.round((stats.processed / stats.total) * 100);
            }
            progressEl.textContent = progress;
            
            // Are we actually done? If server says processing=false OR processed == total
            let isRunning = data.isProcessing;

            if (isRunning) {
                statusMessage.innerHTML = `<i class="fas fa-cog fa-spin"></i> Analizando en segundo plano (Progreso: ${progress}% - ${stats.processed}/${stats.total})`;
            } else {
                if (stats.total > 0 && stats.processed >= stats.total) {
                     statusMessage.innerHTML = '<i class="fas fa-check-circle" style="color: var(--success)"></i> Análisis completado (Guardado en Base de Datos).';
                     isRunning = false; 
                } else if (stats.total > 0) {
                     statusMessage.innerHTML = `<i class="fas fa-info-circle"></i> Análisis en pausa (Progreso: ${progress}% - ${stats.processed}/${stats.total}).`;
                } else {
                    statusMessage.innerHTML = 'Listo para analizar.';
                    dashboard.style.display = 'none';
                    tableContainer.style.display = 'none';
                    isRunning = false;
                }
            }
            
            // Re-apply sorting if any, then render
            if (sortCol) {
                applySortToArray();
            }
            
            renderTable();
            renderPagination();
            
            return isRunning;
            
        } catch (error) {
            console.error("Error polling database", error);
            statusMessage.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: var(--danger)"></i> Servidor no responde. Reintentando en 5s...';
            return true; // pretend it's running so it tries again
        }
    }
    
    function renderTable() {
        tableBody.innerHTML = '';
        
        if (urlData.length === 0) return;

        // Pagination Logic
        const startIndex = (currentPage - 1) * rowsPerPage;
        const endIndex = startIndex + rowsPerPage;
        const paginatedItems = urlData.slice(startIndex, endIndex);

        paginatedItems.forEach((item) => {
            const tr = document.createElement('tr');
            
            let statusClass = 'status-unknown';
            if (item.status && item.status !== 'Pendiente') {
                const s = parseInt(item.status);
                if (s >= 200 && s < 300) statusClass = 'status-200';
                else if (s >= 300 && s < 500) statusClass = 'status-4xx';
                else if (s >= 500) statusClass = 'status-5xx';
            }
            
            let stockHtml = '<span>-</span>';
            if (item.inStock === 'Sí') {
                stockHtml = '<span class="stock-badge stock-yes"><i class="fas fa-check-circle"></i> Sí</span>';
            } else if (item.inStock === 'No') {
                stockHtml = '<span class="stock-badge stock-no"><i class="fas fa-times-circle"></i> No</span>';
            }

            tr.innerHTML = `
                <td class="td-url"><a href="${item.url}" target="_blank" title="${item.url}">${item.url}</a></td>
                <td><span class="status-badge ${statusClass}">${item.status || 'Pendiente'}</span></td>
                <td>${stockHtml}</td>
            `;
            tableBody.appendChild(tr);
        });
    }

    function renderPagination() {
        paginationContainer.innerHTML = '';
        const totalPages = Math.ceil(urlData.length / rowsPerPage);
        
        if (totalPages <= 1) return;

        const prevBtn = document.createElement('button');
        prevBtn.innerText = 'Anterior';
        prevBtn.disabled = currentPage === 1;
        prevBtn.className = 'btn btn-outline btn-sm';
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                renderTable();
                renderPagination();
            }
        });
        
        const nextBtn = document.createElement('button');
        nextBtn.innerText = 'Siguiente';
        nextBtn.disabled = currentPage === totalPages;
        nextBtn.className = 'btn btn-outline btn-sm';
        nextBtn.addEventListener('click', () => {
            if (currentPage < totalPages) {
                currentPage++;
                renderTable();
                renderPagination();
            }
        });

        const pageInfo = document.createElement('span');
        pageInfo.className = 'page-info';
        pageInfo.innerText = `Página ${currentPage} de ${totalPages}`;

        paginationContainer.appendChild(prevBtn);
        paginationContainer.appendChild(pageInfo);
        paginationContainer.appendChild(nextBtn);
    }
    
    function applySortToArray() {
        urlData.sort((a, b) => {
            let valA = a[sortCol];
            let valB = b[sortCol];
            
            if (valA === null || valA === 'Pendiente') valA = -1;
            if (valB === null || valB === 'Pendiente') valB = -1;
            
            // For strings, make sorting case insensitive
            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();
            
            if (valA < valB) return sortAsc ? -1 : 1;
            if (valA > valB) return sortAsc ? 1 : -1;
            return 0;
        });
    }

    function handleSort(col) {
        if (sortCol === col) {
            sortAsc = !sortAsc;
        } else {
            sortCol = col;
            sortAsc = true;
        }
        applySortToArray();
        currentPage = 1; // Reset to page 1 on sort
        renderTable();
        renderPagination();
    }
    
    function exportCSV() {
        if (urlData.length === 0) return;
        
        let csvContent = "data:text/csv;charset=utf-8,";
        csvContent += "URL,Status,Stock\n";
        
        urlData.forEach(item => {
            csvContent += `"${item.url}","${item.status || 'Pendiente'}","${item.inStock || '-'}"\n`;
        });
        
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "fravega_seo_bd_report.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    // Auto-load on startup
    startPolling();
});
