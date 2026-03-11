const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const { parse } = require('csv-parse/sync');
const cron = require('node-cron');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Global state to track background processing
let isProcessing = false;
let stopRequested = false;

// Helpers for sqlite promises
const runQuery = (query, params = []) => new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
        if (err) reject(err); else resolve(this);
    });
});

const getQuery = (query, params = []) => new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
        if (err) reject(err); else resolve(rows);
    });
});

const getSingleQuery = (query, params = []) => new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
        if (err) reject(err); else resolve(row);
    });
});

// GET SPREADSHEET URLS MANUAL
// We moved it up here
app.get('/api/spreadsheet', async (req, res) => {
    try {
        const sheetId = req.query.id || DEFAULT_SHEET_ID;
        const count = await fetchSpreadsheetLogic(sheetId);
        res.json({ success: true, message: 'Spreadsheet importado.', totalUrls: count });
    } catch (err) {
        console.error("Error al obtener Spreadsheet:", err);
        res.status(500).json({ error: "No se pudo leer el Spreadsheet. Verifica que sea público y tenga una hoja llamada 'Listados'." });
    }
});

// BACKGROUND PROCESSOR
async function startBackgroundProcessing() {
    if (isProcessing) return; // Prevent multiple loops
    isProcessing = true;
    stopRequested = false;
    console.log("Iniciando procesamiento en segundo plano...");

    try {
        let hasPending = true;
        const chunkSize = 10;

        while (hasPending && !stopRequested) {
            // Get next pending batch
            const pendingUrls = await getQuery("SELECT id, url FROM urls WHERE status IS NULL OR status = 'Pendiente' LIMIT ?", [chunkSize]);
            
            if (pendingUrls.length === 0) {
                hasPending = false;
                break;
            }

            // Process chunk concurrently
            await Promise.all(pendingUrls.map(checkUrlAndSave));
            
            // Wait 1 second before next batch to be nice to the server
            await new Promise(res => setTimeout(res, 1000));
        }
    } catch (err) {
        console.error("Error en el bucle de procesamiento en segundo plano", err);
    } finally {
        isProcessing = false;
        console.log("Procesamiento en segundo plano finalizado.");
    }
}

async function checkUrlAndSave({ id, url }) {
    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SEO-FVG-Tool' },
            validateStatus: () => true,
            timeout: 10000
        });
        
        const status = response.status;
        let inStock = '-';
        
        if (url.includes('/l/')) {
            if (status === 200) {
                const $ = cheerio.load(response.data);
                const resultsElement = $('span[data-test-id="resultsNumber"]');
                
                if (resultsElement.length > 0) {
                    const resultsNum = parseInt(resultsElement.text().trim(), 10);
                    inStock = (!isNaN(resultsNum) && resultsNum > 0) ? 'Sí' : 'No';
                } else {
                    inStock = 'No';
                }
            } else {
                inStock = 'No';
            }
        }
        
        await runQuery('UPDATE urls SET status = ?, inStock = ? WHERE id = ?', [status, inStock, id]);
        
    } catch (error) {
        const errStatus = error.response ? error.response.status : 500;
        await runQuery('UPDATE urls SET status = ?, inStock = ? WHERE id = ?', [errStatus, '-', id]);
    }
}

// STOP PROCESS
app.get('/api/stop', (req, res) => {
    stopRequested = true;
    console.log("Se ha solicitado detener el análisis...");
    res.json({ success: true, message: 'Análisis detenido.' });
});

// DEFAULT SPREADSHEET URL
const DEFAULT_SHEET_ID = "1oPzqJaragvYG82vKawnajhHD9BnArdDqMBVduCeW9eI";

// FUNCTION TO FETCH SPREADSHEET LOGIC
async function fetchSpreadsheetLogic(sheetId) {
    // First attempt: try getting the CSV export
    const csvUrlsToTry = [
        `https://docs.google.com/spreadsheets/d/${sheetId}/pub?gid=917797808&single=true&output=csv`,
        `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=917797808`
    ];
    
    let response = null;
    let isHtmlView = false;
    
    for (const csvUrl of csvUrlsToTry) {
        try {
            console.log(`Intentando descargar CSV desde: ${csvUrl}`);
            response = await axios.get(csvUrl, { 
                responseType: 'text',
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });
            if (response.status === 200 && response.data) {
                break;
            }
        } catch(e) {
            console.log(`Fallo CSV: ${e.message}`);
        }
    }

    // Second attempt: Parse the public HTML view if CSV is blocked
    if (!response || response.status !== 200) {
        console.log("CSV falló. Intentando extraer datos de la vista HTML pública...");
        const htmlUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/htmlview?gid=917797808`;
        try {
            response = await axios.get(htmlUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });
            isHtmlView = true;
        } catch (e) {
            throw new Error(`Google Sheets rechazó todas las conexiones.`);
        }
    }

    let validUrls = 0;

    return new Promise((resolve, reject) => {
        db.serialize(async () => {
            try {
                db.run('BEGIN TRANSACTION');
                
                const processUrl = (urlStr) => {
                    db.run("INSERT OR IGNORE INTO urls (url, status, inStock) VALUES (?, 'Pendiente', '-')", [urlStr]);
                    validUrls++;
                };
                
                if (!isHtmlView) {
                    const records = parse(response.data, { columns: false, skip_empty_lines: true });
                    for (let i = 0; i < records.length; i++) {
                        const row = records[i];
                        if (row.length > 1) {
                            const colB = row[1] ? row[1].trim() : '';
                            if (colB.startsWith('http')) {
                                processUrl(colB);
                            }
                        }
                    }
                } else {
                    const $ = cheerio.load(response.data);
                    $('tr').each((index, element) => {
                        const tds = $(element).find('td');
                        if (tds.length >= 2) {
                            const colBText = $(tds[1]).text().trim();
                            const colCText = tds.length >= 3 ? $(tds[2]).text().trim() : '';
                            
                            let urlCandidate = '';
                            if (colBText.startsWith('http')) urlCandidate = colBText;
                            else if (colCText.startsWith('http')) urlCandidate = colCText;

                            if (urlCandidate !== '') {
                                 processUrl(urlCandidate);
                            }
                        }
                    });
                }
                db.run('COMMIT');

                const buenosAiresTime = new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })
                                          .replace(', ', ' ').replace('  ', ' ');
                // We use lastUpdated so the frontend dashboard picks it up
                await runQuery('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', ['lastUpdated', buenosAiresTime]);
                await runQuery('DELETE FROM metadata WHERE key = ?', ['totalUrls']);
                
                // Start tracking background validation automatically
                stopRequested = false;
                startBackgroundProcessing();
                
                resolve(validUrls);
            } catch(e) {
                db.run('ROLLBACK');
                reject(e);
            }
        });
    });
}

// CRON SCHEDULER (Only for Local/Persistent Servers)
if (!process.env.VERCEL) {
    const cronSchedule = "0 7,18 * * *";
    cron.schedule(cronSchedule, async () => {
        console.log("⏳ CRON LOCAL: Iniciando actualización automática del Spreadsheet...");
        try {
            const resultCount = await fetchSpreadsheetLogic(DEFAULT_SHEET_ID);
            console.log(`✅ CRON LOCAL Exitoso: Sincronizadas ${resultCount} URLs.`);
        } catch (err) {
            console.error("❌ CRON LOCAL Error:", err.message);
        }
    }, {
      scheduled: true,
      timezone: "America/Argentina/Buenos_Aires"
    });
}

// VERCEL CRON SERVICE ENDPOINT
app.get('/api/cron-update-sheets', async (req, res) => {
    try {
        console.log("⏳ VERCEL CRON: Gatillando actualización mediante webhook HTTP.");
        const resultCount = await fetchSpreadsheetLogic(DEFAULT_SHEET_ID);
        res.status(200).json({ success: true, count: resultCount });
    } catch (err) {
        console.error("❌ VERCEL CRON Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// Removed /api/spreadsheet-data and redundant /api/spreadsheet

// GET NEXT CRON EXECUTION TIME
app.get('/api/spreadsheet-next-update', (req, res) => {
    // We statically know it runs at 7:00 and 18:00 BA Time.
    // Calculate the next one from current time in BA.
    const nowLocal = new Date();
    // Getting string like '3/9/2026, 17:01:00'
    const baTimeStr = nowLocal.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires", hour12: false });
    const baDateObj = new Date(baTimeStr); // Parse it back to getting the numeric hour/minute relative to BA
    
    const h = baDateObj.getHours();
    
    let nextRun = new Date(baDateObj.getTime());
    nextRun.setMinutes(0);
    nextRun.setSeconds(0);
    nextRun.setMilliseconds(0);

    if (h < 7) {
        nextRun.setHours(7);
    } else if (h < 18) {
        nextRun.setHours(18);
    } else {
        // Next day at 7 AM
        nextRun.setDate(nextRun.getDate() + 1);
        nextRun.setHours(7);
    }
    
    const diffMs = nextRun.getTime() - baDateObj.getTime();
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffMins = Math.floor((diffMs % 3600000) / 60000);
    
    const formattedNextRun = nextRun.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })
                                     .replace(', ', ' ').replace('  ', ' ');
                                     
    res.json({ 
        success: true, 
        nextUpdateBA: formattedNextRun,
        hoursLeft: diffHrs,
        minutesLeft: diffMins
    });
});

// GET PROGRESS FOR FRONTEND
app.get('/api/progress', async (req, res) => {
    try {
        const urls = await getQuery('SELECT * FROM urls ORDER BY id ASC');
        const metadataRows = await getQuery('SELECT * FROM metadata');
        
        const metadata = {};
        metadataRows.forEach(row => metadata[row.key] = row.value);
        
        const cleanDate = metadata.lastUpdated || '-';

        // Calculate stats
        const stats = {
            total: parseInt(metadata.totalUrls || urls.length),
            lastUpdated: cleanDate,
            processed: 0,
            outOfStock: 0,
            statusCodes: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }
        };

        urls.forEach(u => {
            if (u.status !== null && u.status !== 'Pendiente') {
                stats.processed++;
                const statusNum = parseInt(u.status);
                
                if (statusNum >= 200 && statusNum < 300) stats.statusCodes['2xx']++;
                else if (statusNum >= 300 && statusNum < 400) stats.statusCodes['3xx']++;
                else if (statusNum >= 400 && statusNum < 500) stats.statusCodes['4xx']++;
                else if (statusNum >= 500) stats.statusCodes['5xx']++;

                if (u.inStock === 'No') stats.outOfStock++;
            }
        });

        res.json({
            isProcessing,
            stats,
            urls
        });

    } catch (err) {
        res.status(500).json({ error: 'Error leyendo la base de datos' });
    }
});

if (process.env.VERCEL) {
    module.exports = app;
} else {
    app.listen(PORT, () => {
        console.log(`Servidor SEO Backend con DB escuchando en http://localhost:${PORT}`);
        
        // Auto-resume if there are pending jobs on startup, wait a bit for DB to init
        setTimeout(() => {
            getQuery("SELECT count(*) as count FROM urls WHERE status IS NULL OR status = 'Pendiente'")
                .then(res => {
                    if (res[0].count > 0) {
                        console.log(`Encontradas ${res[0].count} URLs pendientes. Reanudando proceso en segundo plano...`);
                        startBackgroundProcessing();
                    }
                }).catch(err => console.error("Error al reanudar:", err.message));
        }, 1000);
    });
}
