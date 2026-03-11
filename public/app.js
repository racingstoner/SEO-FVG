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
    const rowsPerPage = 20;
    
    // Sorting state
    let sortCol = '';
    let sortAsc = true;

    analyzeBtn.addEventListener('click', startAnalysis);
    stopBtn.addEventListener('click', stopAnalysis);
    
    thElements.forEach(th => {
        th.addEventListener('click', () => handleSort(th.dataset.sort));
    });
    
    exportCsvBtn.addEventListener('click', exportCSV);

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
        statusMessage.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Obteniendo y guardando URLs desde Google Sheets...';
        currentPage = 1;
        urlData = [];
        
        try {
            const response = await fetch(`/api/spreadsheet?id=${encodeURIComponent(sheetId)}`);
            const data = await response.json();
            
            if (data.error) throw new Error(data.error);
            
            // Spreadsheet fetched successfully and saved to DB
            statusMessage.innerHTML = '<i class="fas fa-check-circle" style="color: var(--success)"></i> URLs Importadas Correctamente.';
            analyzeBtn.style.display = 'flex';
            
            // Fetch the updated URLs and render
            fetchProgress();

        } catch (error) {
            statusMessage.innerHTML = `<i class="fas fa-times-circle" style="color: var(--danger)"></i> Error: ${error.message}`;
            analyzeBtn.style.display = 'flex';
        }
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
            
            // Show table since we have data
            if (urlData.length > 0) {
                dashboard.style.display = 'grid';
                tableContainer.style.display = 'block';
            }
            
            // Re-apply sorting if any, then render
            if (sortCol) {
                applySortToArray();
            }
            
            renderTable();
            renderPagination();
            
        } catch (error) {
            console.error("Error polling database", error);
            statusMessage.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: var(--danger)"></i> Error de conexión con la base de datos.';
        }
    }
    
    function renderTable() {
        tableBody.innerHTML = '';
        
        if (urlData.length === 0) return;

        // Pagination Logic
        const startIndex = (currentPage - 1) * rowsPerPage;
        const endIndex = startIndex + rowsPerPage;
        const paginatedItems = urlData.slice(startIndex, endIndex);

        paginatedItems.forEach((item, index) => {
            const tr = document.createElement('tr');
            
            // Calculate absolute row number based on pagination
            const rowNumber = startIndex + index + 1;

            tr.innerHTML = `
                <td>${rowNumber}</td>
                <td class="td-url"><a href="${item.url}" target="_blank" title="${item.url}">${item.url}</a></td>
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
        csvContent += "N°,URL\n";
        
        urlData.forEach((item, index) => {
            csvContent += `"${index + 1}","${item.url}"\n`;
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
    fetchProgress();
});
