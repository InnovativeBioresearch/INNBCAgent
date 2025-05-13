import { summarizePaper, extractTableData } from './src/plugin/innbcagent.js';

function updateLoading(message, progress) {
  return new Promise(resolve => {
    setTimeout(() => {
      requestAnimationFrame(() => {
        const loadingText = document.getElementById('loading-text');
        const loadingBar = document.getElementById('loading');
        const progressBarFill = document.querySelector('.progress-bar-fill');

        if (!loadingText || !loadingBar || !progressBarFill) {
          console.error('Loading elements not found:', { loadingText, loadingBar, progressBarFill });
          resolve();
          return;
        }

        console.log('Updating loading:', message, progress); // Debug log
        loadingText.textContent = message;
        loadingBar.style.display = 'block';
        progressBarFill.style.width = `${progress}%`;
        resolve();
      });
    }, 300); // 300ms delay
  });
}

// Initialize global variables for XLSX processing
let gk_isXlsx = false;
let gk_xlsxFileLookup = {};
let gk_fileData = {};
let env = {};

// Unchanged functions: showDownloadButton, filledCell, loadFileData, extractTextFromPDF, extractTextFromXLSX
function showDownloadButton() {
  document.getElementById('download-pdf').style.display = 'block';
}

function filledCell(cell) {
  return cell !== '' && cell != null;
}

function loadFileData(filename) {
  if (gk_isXlsx && gk_xlsxFileLookup[filename]) {
    try {
      var workbook = XLSX.read(gk_fileData[filename], { type: 'base64' });
      var firstSheetName = workbook.SheetNames[0];
      var worksheet = workbook.Sheets[firstSheetName];
      var jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false, defval: '' });
      var filteredData = jsonData.filter(row => row.some(cell => cell !== '' && cell != null));
      var headerRowIndex = filteredData.findIndex((row, index) =>
        row.filter(cell => cell !== '' && cell != null).length >= filteredData[index + 1]?.filter(cell => cell !== '' && cell != null).length
      );
      if (headerRowIndex === -1 || headerRowIndex > 25) {
        headerRowIndex = 0;
      }
      var csv = XLSX.utils.aoa_to_sheet(filteredData.slice(headerRowIndex));
      csv = XLSX.utils.sheet_to_csv(csv, { header: 1 });
      return csv;
    } catch (e) {
      console.error(e);
      return "";
    }
  }
  return gk_fileData[filename] || "";
}

async function extractTextFromPDF(file) {
  try {
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_FILE_SIZE) {
      throw new Error('File size exceeds 10MB limit.');
    }
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc = '//cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
    let text = '';
    const MAX_PAGES = 50; // Limit to 50 pages
    for (let i = 1; i <= Math.min(pdf.numPages, MAX_PAGES); i++) {
      await updateLoading(`Processing PDF page ${i} of ${Math.min(pdf.numPages, MAX_PAGES)}...`, 55 + (i / Math.min(pdf.numPages, MAX_PAGES)) * 10);
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n';
    }
    console.log('Extracted PDF text:', text.slice(0, 200) + '...');
    return text.trim();
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw new Error('File size exceeds 10MB limit');
  }
}

async function extractTextFromXLSX(file) {
  try {
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_FILE_SIZE) {
      throw new Error('File size exceeds 10MB limit.');
    }
    await updateLoading('Processing XLSX file...', 55);
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    gk_isXlsx = true;
    gk_xlsxFileLookup[file.name] = true;
    gk_fileData[file.name] = base64;
    const csv = loadFileData(file.name);
    console.log('Extracted XLSX CSV:', csv.slice(0, 200) + '...');
    return csv.trim();
  } catch (error) {
    console.error('XLSX extraction error:', error);
    throw new Error('File size exceeds 10MB limit');
  }
}

// RESTORED: Original searchPubMed with new double [All Fields] fallback
async function searchPubMed(query) {
  console.log('Calling searchPubMed with query:', query);

  // Split query into terms or phrases
  const terms = query.match(/"[^"]+"|[^\s]+/g) || [query];
  const cleanTerms = terms.map(term => term.replace(/^"|"$/g, ''));

  // Filter out prepositions
  const prepositions = ['in', 'on', 'per', 'for', 'of', 'to', 'with', 'at', 'by'];
  const filteredTerms = cleanTerms.filter(term => !prepositions.includes(term.toLowerCase()));
  console.log('Filtered terms (excluding prepositions):', filteredTerms);

  // Function to generate case variants
  function generateCaseVariants(term) {
    const variants = new Set();
    const words = term.split(/\s+/);
    const combinations = generateWordCombinations(words);
    combinations.forEach(comb => {
      variants.add(comb.join(' '));
    });
    return Array.from(variants);
  }

  function generateWordCombinations(words) {
    if (!words.length) return [[]];
    const first = words[0];
    const rest = words.slice(1);
    const restCombinations = generateWordCombinations(rest);
    const result = [];
    const variants = [
      first,
      first.charAt(0).toUpperCase() + first.slice(1).toLowerCase(),
      first.toUpperCase()
    ].filter(v => v);
    variants.forEach(variant => {
      restCombinations.forEach(restComb => {
        result.push([variant, ...restComb]);
      });
    });
    return result;
  }

  let ids = [];
  const termVariants = {};
  for (const term of filteredTerms) {
    termVariants[term] = generateCaseVariants(term);
  }

  try {
  
    // Promoted [All Fields] to Primary Search
    const primaryQuery = filteredTerms.map(term => `"${term}"[All Fields]`).join(' AND ');
    // Changed retmax=5 to retmax=6 to allow up to 6 papers
    const primaryUrl = `/api/pubmed/esearch.fcgi?db=pubmed&term=${encodeURIComponent(primaryQuery)}&retmax=6&retmode=json&sort=relevance`;
    console.log('Primary PubMed URL:', primaryUrl);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(primaryUrl);
        if (!response.ok) {
          if (response.status === 429) {
            console.warn(`Rate limit hit in primary search, retrying (${attempt}/3)...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          throw new Error(`Primary search failed: ${response.statusText}`);
        }
        const data = await response.json();
        ids = data.esearchresult?.idlist || [];
        console.log('Primary PubMed IDs:', ids);
        break;
      } catch (error) {
        console.warn(`Primary attempt ${attempt} failed: ${error.message}`);
        if (attempt === 3) throw error;
      }
    }
    
    // Changed condition from <5 to <6 here and above 
    // Fallback: Pairwise and individual terms [All Fields]
    if (ids.length < 6) {
      console.log(`Primary search [All Fields] returned ${ids.length} papers, attempting pairwise [All Fields] fallback...`);
      const allFieldIds = new Set(ids); // Retain primary search IDs


      // Step 1: Pairwise [All Fields] if still <6
      if (allFieldIds.size < 6 && filteredTerms.length > 1) {
        console.log(`Primary search [All Fields] returned ${allFieldIds.size} papers, attempting pairwise [All Fields] fallback...`);
        // START CHANGE: Add pairs array creation for independent Step 2
        const pairs = [];
        for (let i = 0; i < filteredTerms.length; i++) {
          for (let j = i + 1; j < filteredTerms.length; j++) {
            pairs.push([filteredTerms[i], filteredTerms[j]]);
          }
        }
        // Changed size check from >=5 to >=6
        for (const [term1, term2] of pairs) {
          if (allFieldIds.size >= 6) break;
          const variants1 = termVariants[term1].map(v => `"${v}"[All Fields]`);
          const variants2 = termVariants[term2].map(v => `"${v}"[All Fields]`);
          const pairQuery = `(${variants1.join(' OR ')}) AND (${variants2.join(' OR ')})`;
          // Changed retmax=5 to retmax=6
          const pairUrl = `/api/pubmed/esearch.fcgi?db=pubmed&term=${encodeURIComponent(pairQuery)}&retmax=${6 - ids.length}&retmode=json&sort=relevance`;
          console.log('Pairwise [All Fields] Fallback URL:', pairUrl);

          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const response = await fetch(pairUrl);
              if (!response.ok) {
                if (response.status === 429) {
                  console.warn(`Rate limit hit in pairwise [All Fields] fallback, retrying (${attempt}/3)...`);
                  await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                  continue;
                }
                throw new Error(`Pairwise [All Fields] fallback failed: ${response.statusText}`);
              }
              const data = await response.json();
              const newIds = data.esearchresult?.idlist || [];
              console.log(`Pairwise [All Fields] IDs for ${term1}+${term2}:`, newIds);
              newIds.forEach(id => allFieldIds.add(id));
              break;
            } catch (error) {
              console.warn(`Pairwise [All Fields] fallback attempt ${attempt} failed: ${error.message}`);
            }
          }
        }
      }

      // Step 2: Individual terms [All Fields] if still <6
      if (allFieldIds.size < 6) {
        console.log(`Pairwise [All Fields] fallback returned ${allFieldIds.size} papers, attempting individual term [All Fields] fallback...`);
        for (const term of filteredTerms) {
          if (allFieldIds.size >= 6) break;
          const termQuery = `"${term}"[All Fields]`;
          // Changed retmax=5 to retmax=6
          const termUrl = `/api/pubmed/esearch.fcgi?db=pubmed&term=${encodeURIComponent(termQuery)}&retmax=${6 - ids.length}&retmode=json&sort=relevance`;
          console.log('Individual term [All Fields] URL for', term, ':', termUrl);

          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const response = await fetch(termUrl);
              if (!response.ok) {
                if (response.status === 429) {
                  console.warn(`Rate limit hit in individual term fallback, retrying (${attempt}/3)...`);
                  await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                  continue;
                }
                throw new Error(`Individual term [All Fields] fallback failed: ${response.statusText}`);
              }
              const data = await response.json();
              const newIds = data.esearchresult?.idlist || [];
              console.log(`Individual Term [All Fields] IDs for ${term}:`, newIds);
              newIds.forEach(id => allFieldIds.add(id));
              break;
            } catch (error) {
              console.warn(`Individual term [All Fields] fallback attempt ${attempt} failed: ${error.message}`);
            }
          }
        }
      }
      // Changed slice(0, 5) to slice(0, 6) to retain up to 6 unique IDs
      ids = Array.from(allFieldIds).slice(0, 6);
      console.log('Combined [All Fields] Fallback IDs:', ids);
    }
    // SECOND CHANGE FINISHED - Updated fallback logic to remove full query [All Fields] and correct log message
  } catch (error) {
    console.error('Error in searchPubMed:', error);
    return { pubmedPapers: [], pmcPapers: [], paperCount: 0 }; // Added paperCount to avoid undefined 
  }

    // Fetch paper details using efetch.fcgi
    const papers = [];
    for (const id of ids) {
      const fetchUrl = `/api/pubmed/efetch.fcgi?db=pubmed&id=${id}&retmode=xml`;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const response = await fetch(fetchUrl);
          if (!response.ok) {
            console.warn(`Fetch failed for ID ${id}, attempt ${attempt}`);
            if (attempt === 3) break;
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          const xmlText = await response.text();
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
          
          const title = xmlDoc.querySelector('ArticleTitle')?.textContent || 'Untitled';
          const abstract = xmlDoc.querySelector('AbstractText')?.textContent || 'No abstract';
          const authors = Array.from(xmlDoc.querySelectorAll('Author')).map(a => {
            const lastName = a.querySelector('LastName')?.textContent || '';
            const initials = a.querySelector('Initials')?.textContent || '';
            return lastName ? `${lastName} ${initials}` : 'Unknown';
          });
          const journal = xmlDoc.querySelector('Journal Title')?.textContent || 'Unknown';
          const pubdate = xmlDoc.querySelector('PubDate Year')?.textContent || 'Unknown';

          papers.push({
            pmid: id,
            title,
            abstract,
            authors,
            journal,
            pubdate
          });
          break;
        } catch (error) {
          console.warn(`Fetch attempt ${attempt} for ID ${id} failed:`, error);
          if (attempt === 3) console.error(`Failed to fetch ID ${id}`);
        }
      }
    }

   // Fetch PMC full-text
   const pmcPapers = await fetchPmcFullText(papers);
   console.log('PubMed papers:', papers);
   console.log('PMC papers:', pmcPapers);
   return { pubmedPapers: papers, pmcPapers, paperCount: ids.length }; // Added paperCount
}

async function fetchPmcFullText(papers) {
  const pmcPapers = [];
  let count = 0;
  console.log('Fetching PMC full-text for papers:', papers.map(p => p.pmid));
  for (const paper of papers) {
    if (count >= 2) break;
    try {
      const idConvUrl = `/api/pubmed/elink.fcgi?dbfrom=pubmed&db=pmc&id=${paper.pmid}&retmode=json`;
      console.log('PMC ID URL:', idConvUrl);
      const idConvResponse = await fetch(idConvUrl);
      if (!idConvResponse.ok) {
        console.warn(`ID conversion failed for PMID ${paper.pmid}`);
        continue;
      }
      const idConvData = await idConvResponse.json();
      const link = idConvData.linksets[0]?.linksetdbs?.find(db => db.dbto === 'pmc')?.links;
      if (!link || !link[0]) {
        console.log(`No PMC link for PMID ${paper.pmid}`);
        continue;
      }
      const pmcid = link[0];

      const pmcUrl = `/api/pubmed/efetch.fcgi?db=pmc&id=${pmcid}&retmode=xml`;
      console.log('PMC fetch URL:', pmcUrl);
      const pmcResponse = await fetch(pmcUrl);
      if (!pmcResponse.ok) {
        console.warn(`PMC fetch failed for PMCID ${pmcid}`);
        continue;
      }
      const pmcText = await pmcResponse.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(pmcText, 'text/xml');

      let fullText = '';
      const abstract = xmlDoc.querySelector('abstract')?.textContent || '';
      const bodySections = xmlDoc.querySelectorAll('sec');
      bodySections.forEach(sec => {
        const title = sec.querySelector('title')?.textContent || '';
        const paras = sec.querySelectorAll('p');
        fullText += (title ? `\n${title}\n` : '') + Array.from(paras).map(p => p.textContent).join('\n') + '\n';
      });
      fullText = (abstract + '\n' + fullText).trim();

      pmcPapers.push({
        pmcid,
        fullText: fullText || 'No full text available',
      });
      count++;
    } catch (error) {
      console.error(`PMC fetch error for PMID ${paper.pmid}:`, error);
    }
  }
  console.log('PMC papers:', pmcPapers);
  return pmcPapers;
}

function parseReport(report) {
  console.log('Raw report from API:', JSON.stringify(report));
  
  const reportData = {
    title: 'Research Summary',
    abstract: 'No abstract',
    introduction: 'No introduction',
    results: 'No results',
    conclusions: 'No conclusions',
    references: []
  };

  try {
    let json = JSON.parse(report);
    reportData.title = json.title || reportData.title;
    reportData.abstract = json.abstract || reportData.abstract;
    reportData.introduction = json.introduction || reportData.introduction;
    reportData.results = json.results || reportData.results;
    reportData.conclusions = json.conclusions || reportData.conclusions;
    reportData.references = Array.isArray(json.references) ? json.references : reportData.references;
  } catch (error) {
    console.error('JSON parsing error:', error);
    try {
      let cleanedReport = report.replace(/,\s*"[^"]*$/, '');
      cleanedReport = cleanedReport.replace(/\[\s*$/, '[]');
      if (!cleanedReport.endsWith('}')) {
        cleanedReport += '}';
      }
      const json = JSON.parse(cleanedReport);
      reportData.title = json.title || reportData.title;
      reportData.abstract = json.abstract || reportData.abstract;
      reportData.introduction = json.introduction || reportData.introduction;
      reportData.results = json.results || reportData.results;
      reportData.conclusions = json.conclusions || reportData.conclusions;
      reportData.references = Array.isArray(json.references) ? json.references : reportData.references;
    } catch (cleanError) {
      console.error('Clean JSON parsing failed:', cleanError);
      reportData.abstract = 'Failed to parse report due to malformed JSON. Partial data may be available.';
      const partialMatch = report.match(/"title":"([^"]+)"/);
      if (partialMatch) reportData.title = partialMatch[1];
    }
  }

  console.log('Parsed report:', reportData);
  return reportData;
}

function renderReport(reportData) {
  document.getElementById('report-title').textContent = reportData.title || 'No title';
  let abstractText = reportData.abstract || 'No abstract';
  if (abstractText.includes('Failed to parse')) {
    abstractText = `Note: Report may be incomplete due to API response issues. ${abstractText}`;
  }
  document.getElementById('report-abstract').textContent = abstractText;
  document.getElementById('report-introduction').textContent = reportData.introduction || 'No introduction';
  document.getElementById('report-results').textContent = reportData.results || 'No results';
  document.getElementById('report-conclusions').textContent = reportData.conclusions || 'No conclusions';
  
  const referencesList = document.getElementById('report-references');
  referencesList.innerHTML = '';
  if (reportData.nonMedicalQuery) { // NEW CHANGE MADE: Check nonMedicalQuery to display message
    const li = document.createElement('li');
    li.textContent = 'This is a non-medical query, and the response was generated using general knowledge.';
    li.style.fontStyle = 'italic';
    li.style.color = '#555';
    referencesList.appendChild(li);    
  } else if (reportData.references.length > 0) {
    reportData.references.forEach((ref, index) => {
      const li = document.createElement('li');
      li.textContent = `${index + 1}. ${ref}`;
      referencesList.appendChild(li);
    });
  }
  
  document.getElementById('report').style.display = 'block';
  showDownloadButton();
}

function renderTable(data) {
  const dataTable = document.getElementById('data-table');
  dataTable.innerHTML = '';

  data.labels.forEach((label, index) => {
    const column = document.createElement('div');
    column.className = 'table-column';

    const headerCell = document.createElement('div');
    headerCell.className = 'table-cell header';
    headerCell.textContent = label;
    headerCell.title = label;
    column.appendChild(headerCell);

    const valueCell = document.createElement('div');
    valueCell.className = 'table-cell';
    const unit = data.units && data.units[index] ? data.units[index] : 'unknown';
    valueCell.textContent = unit === 'none' || unit === 'unknown' ? data.values[index] : `${data.values[index]} ${unit}`;
    if (typeof data.values[index] === 'number' && data.values[index] < 0) {
      valueCell.style.color = 'red';
    }
    column.appendChild(valueCell);

    dataTable.appendChild(column);
  });

  document.getElementById('results-table').style.display = 'block';
  console.log('Rendered table:', data);
}

function renderGraph(data) {
  const ctx = document.getElementById('graph').getContext('2d');
  
  if (window.myChart) {
    window.myChart.destroy();
  }
  
  window.myChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.labels.map((label, index) => {
        const unit = data.units && data.units[index] ? data.units[index] : 'unknown';
        const shortLabel = label.length > 50 ? label.slice(0, 50) + '...' : label;
        return unit === 'none' || unit === 'unknown' ? shortLabel : `${shortLabel} (${unit})`;
      }),
      datasets: [{
        label: 'Data',
        data: data.values,
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        borderColor: 'rgba(75, 192, 192, 1)',
        borderWidth: 1
      }]
    },
    options: {
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Value' }
        }
      }
    }
  });
  
  document.getElementById('graph').style.display = 'block';
  console.log('Rendered graph:', data);
}

// Global in-memory cache for reports
const reportCache = {};

function toggleSearchButton(disabled) {
  const searchButton = document.getElementById('search-button');
  if (searchButton) {
    searchButton.disabled = disabled;
  }
}

async function handleSearch() {
  // Disable the search button to prevent spamming
  toggleSearchButton(true);
  gk_isXlsx = false;
  gk_xlsxFileLookup = {};
  gk_fileData = {};

  document.getElementById('loading').style.display = 'block';
  
  document.getElementById('report').style.display = 'none';
  document.getElementById('results-table').style.display = 'none';
  document.getElementById('graph').style.display = 'none';
  document.getElementById('report-title').textContent = '';
  document.getElementById('report-abstract').textContent = '';
  document.getElementById('report-introduction').textContent = '';
  document.getElementById('report-results').textContent = '';
  document.getElementById('report-conclusions').textContent = '';
  document.getElementById('report-references').innerHTML = '';
  document.getElementById('data-table').innerHTML = '';
  document.getElementById('feedback').textContent = '';
  
  if (window.myChart) {
    window.myChart.destroy();
  }

  const query = document.getElementById('search-input').value.trim();
  const file = document.getElementById('pdf-upload').files[0];
  let content = '';

  console.log('Search initiated - Query:', query);
  if (file !== undefined) {
    console.log('Search initiated - File:', file);
  }

  if (!query && !file) {
    alert('Please enter a query or upload a PDF/XLSX file.');
    console.log('Search aborted: No query or file provided');
    // Hide and reset loading bar
    const loading = document.getElementById('loading');
    const loadingText = document.getElementById('loading-text');
    const progressBarFill = document.querySelector('.progress-bar-fill');
    if (loading && loadingText && progressBarFill) {
      loading.style.display = 'none';
      loadingText.textContent = '';
      progressBarFill.style.width = '0%';
    }
    // Re-enable the search button
    toggleSearchButton(false);
    return;
  }

  // Generate cache key: query (lowercase) + file name/size (if any)
  const cacheKey = query 
    ? file 
      ? `${query.toLowerCase()}|${file.name}|${file.size}`
      : query.toLowerCase()
    : `file|${file.name}|${file.size}`;
  console.log('Cache key:', cacheKey);

  // Check cache for existing results
  if (reportCache[cacheKey]) {
    console.log('Cache hit for:', cacheKey);
    const { reportData, tableData } = reportCache[cacheKey];
    await updateLoading('Rendering cached report...', 90);
    renderReport(reportData);
    if (tableData && tableData.labels && tableData.labels.length > 0 && 
        tableData.values && tableData.values.length > 0 && 
        tableData.units && tableData.units.length === tableData.labels.length &&
        tableData.values.every(val => typeof val === 'number' && !isNaN(val))) {
      renderTable(tableData);
      renderGraph(tableData);
    } else {
      console.log('No cached table data');
    }
    document.getElementById('loading').style.display = 'none';
    // Re-enable the search button
    toggleSearchButton(false);
    return;
  }

  // Initialize loading
  await updateLoading('Initializing search...', 10);

  try {
    let papers = [];
    let pmcPapers = [];
    let paperCount = 0; // Default paper count

    if (query) {
      await updateLoading('Searching PubMed literature...', 30); //added visual input loading progress
      console.log('Calling searchPubMed with query:', query);
      const searchResult = await searchPubMed(query);
      papers = searchResult.pubmedPapers;
      pmcPapers = searchResult.pmcPapers;
      paperCount = searchResult.paperCount; // Set paper count (removed 'const')
      console.log('searchPubMed returned papers:', papers);
      console.log('searchPubMed returned PMC papers:', pmcPapers);
      if (!papers.length) {
        console.warn('No PubMed papers found, using query as content');
        alert('No PubMed papers found for query; generating report based on query text.');
        content = `No PubMed papers found for query: "${query}". Summarize based on available knowledge.`;
      } else {
        content = papers.map(p => `Title: ${p.title}\nAbstract: ${p.abstract}\nAuthors: ${p.authors.join(', ')}\nPublication: ${p.journal} (${p.pubdate}) (PMID: ${p.pmid})`).join('\n\n');
        content += pmcPapers.map(p => `\n\nPMC Full Text (PMCID: ${p.pmcid}):\n${p.fullText}`).join('\n\n');
      }
    }

    if (file) {
      await updateLoading(`Processing uploaded ${file.type.includes('pdf') ? 'PDF' : 'XLSX'} file...`, 55);
      console.log('Processing uploaded file:', file?.name || 'none');
      if (file.type === 'application/pdf') {
        const pdfText = await extractTextFromPDF(file);
        content += `\n\nPDF Content:\n${pdfText}`;
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
        const xlsxText = await extractTextFromXLSX(file);
        content += `\n\nXLSX Content:\n${xlsxText}`;
      } else {
        alert('Please upload a PDF or XLSX file.');
        console.log('Search aborted: Invalid file type');
        return;
      }
    }

    if (!content.trim()) {
      throw new Error('No content generated from query or file.');
    }
    // Use paper count in message if query was provided, otherwise generic message
    const reportMessage = query 
      ? `Found ${paperCount} paper${paperCount === 1 ? '' : 's'}...generating scientific report...`
      : 'Generating scientific report...';
    await updateLoading(reportMessage, 70);
    console.log('API input for summarizePaper:', content.slice(0, 200) + '...');

    // Call summarizePaper without papers, as references are constructed directly
    const report = await summarizePaper(content, query);
    console.log('summarizePaper returned report:', report);
    await updateLoading('Extracting data for table and graph...', 85);
    
    // Parse report once for efficiency
    const reportData = JSON.parse(report);

    // Construct references directly from papers to ensure accuracy
    const references = papers.length && !reportData.nonMedicalQuery // NEW CHANGE MADE: Only generate references if nonMedicalQuery is false
        ? papers.map(p => {
      const authors = p.authors.length > 1 ? `${p.authors[0].split(' ')[0]} et al.` : p.authors[0];
      // Remove trailing period from title, if present
      const cleanedTitle = p.title.replace(/\.$/, '');
      return `${authors} (${p.pubdate}). ${cleanedTitle}. ${p.journal}. PMID: ${p.pmid}`;
    })
    : []; // NEW CHANGE MADE: Empty references array if nonMedicalQuery is true
  
    // NEW CHANGE MADE: Add reference for uploaded file using full filename (including extension)
    if (file) {
      references.push(`Local file: ${file.name}`);
    }
  
    // Merge references into reportData
    reportData.references = references;

    // Define tableContent using reportData.results to avoid redundant JSON.parse
    const tableContent = papers.length 
      ? papers.map(p => p.abstract).join('\n\n') + '\n\n' + pmcPapers.map(p => p.fullText).join('\n\n') + '\n\n' + reportData.results 
      : content;
    console.log('API input for extractTableData:', tableContent.slice(0, 200) + '...');
    let tableData = await extractTableData(tableContent, query);
    console.log('extractTableData returned tableData:', tableData);
    
    if (!tableData && reportData.results) {
      console.log('Retrying extractTableData with report results:', reportData.results.slice(0, 200) + '...');
      tableData = await extractTableData(reportData.results, query);
      console.log('Retry extractTableData returned tableData:', tableData);
    }

    // Store results in cache (only reportData and tableData, no PMC full-texts)
    reportCache[cacheKey] = { reportData, tableData };
    console.log('Cached results for:', cacheKey);

    //updateLoading('Rendering report...', 100);
    renderReport(reportData);

    if (tableData && tableData.labels && tableData.labels.length > 0 && 
        tableData.values && tableData.values.length > 0 && 
        tableData.units && tableData.units.length === tableData.labels.length &&
        tableData.values.every(val => typeof val === 'number' && !isNaN(val))) {
      renderTable(tableData);
      renderGraph(tableData);
    } else { 
      console.log('No table data');
    }
  } catch (error) {
    console.error('Search error:', error);
    alert('Failed to generate report: ' + error.message);
  } finally {
    document.getElementById('loading').style.display = 'none';
    // Re-enable the search button
    toggleSearchButton(false);
  }
}

function handleClear() {
  document.getElementById('search-input').value = '';
  document.getElementById('pdf-upload').value = '';
  document.getElementById('report').style.display = 'none';
  document.getElementById('results-table').style.display = 'none';
  document.getElementById('graph').style.display = 'none';
  document.getElementById('report-title').textContent = '';
  document.getElementById('report-abstract').textContent = '';
  document.getElementById('report-introduction').textContent = '';
  document.getElementById('report-results').textContent = '';
  document.getElementById('report-conclusions').textContent = '';
  document.getElementById('report-references').innerHTML = '';
  document.getElementById('data-table').innerHTML = '';
  
  if (window.myChart) {
    window.myChart.destroy();
  }
  
  gk_isXlsx = false;
  gk_xlsxFileLookup = {};
  gk_fileData = {};
  
  console.log('Cleared UI and data');
  document.getElementById('download-pdf').style.display = 'none';
}

function downloadPDF() {
  const reportData = {
    title: document.getElementById('report-title').textContent || 'No title',
    abstract: document.getElementById('report-abstract').textContent || 'No abstract',
    introduction: document.getElementById('report-introduction').textContent || 'No introduction',
    results: document.getElementById('report-results').textContent || 'No results',
    conclusions: document.getElementById('report-conclusions').textContent || 'No conclusions',
    references: Array.from(document.getElementById('report-references').getElementsByTagName('li')).map(li => li.textContent)
  };

  const tableData = [];
  const dataTable = document.getElementById('data-table');
  const columns = dataTable.getElementsByClassName('table-column');
  if (columns.length > 0) {
    Array.from(columns).forEach(column => {
      const cells = column.getElementsByClassName('table-cell');
      if (cells.length >= 2) {
        const header = cells[0].textContent || 'Unknown';
        const value = cells[1].textContent || 'N/A';
        tableData.push([header, value]);
      }
    });
  }

  let graphImage = null;
  const canvas = document.getElementById('graph');
  if (canvas && canvas.style.display !== 'none' && canvas.width > 0 && canvas.height > 0) {
    try {
      graphImage = canvas.toDataURL('image/png');
    } catch (error) {
      console.error('Failed to convert graph to image:', error);
    }
  }

  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [20, 20, 20, 20],
    content: [
      { text: 'INNBC AI Agent Scientific Report', style: 'mainTitle' },
      { text: 'Title', style: 'sectionHeader' },
      { text: reportData.title, style: 'title' },
      { text: 'Abstract', style: 'sectionHeader' },
      { text: reportData.abstract, style: 'paragraph' },
      { text: 'Introduction', style: 'sectionHeader' },
      { text: reportData.introduction, style: 'paragraph' },
      { text: 'Results', style: 'sectionHeader' },
      { text: reportData.results, style: 'paragraph' },
      tableData.length > 0 ? {
        table: {
          headerRows: 1,
          widths: ['50%', '50%'],
          body: [
            [{ text: 'Header', style: 'tableHeader' }, { text: 'Value', style: 'tableHeader' }],
            ...tableData.map(row => [{ text: row[0], style: 'tableCell' }, { text: row[1], style: 'tableCell' }])
          ]
        },
        layout: 'lightHorizontalLines'
      } : { text: 'Extracted Data Table (not available)', style: 'paragraph' },
      graphImage ? {
        image: graphImage,
        width: 450,
        margin: [0, 10, 0, 10]
      } : { text: 'Graph (not available)', style: 'paragraph' },
      { text: 'Conclusions', style: 'sectionHeader' },
      { text: reportData.conclusions, style: 'paragraph' },
      reportData.nonMedicalQuery ? [ // NEW CHANGE MADE: Use nonMedicalQuery for PDF references
      { text: 'References', style: 'sectionHeader' },
        { text: 'This is a non-medical query, and the response was generated using general knowledge.', style: 'paragraph', italics: true }    
      ] : reportData.references.length > 0 ? [
        { text: 'References', style: 'sectionHeader' },
        {
          ul: reportData.references.map(ref => ({ text: ref, style: 'paragraph' }))
        }
      ] : [],
      {
        text: 'This report was generated by INNBC AI agent available at https://innbcagent.innovativebioresearch.com/',
        style: 'footer',
        margin: [0, 10, 0, 0]
      }
    ],
    styles: {
      mainTitle: {
        fontSize: 16,
        bold: true,
        margin: [0, 0, 0, 10]
      },
      title: {
        fontSize: 14,
        bold: true,
        margin: [0, 0, 0, 10]
      },
      sectionHeader: {
        fontSize: 12,
        bold: true,
        margin: [0, 10, 0, 5]
      },
      paragraph: {
        fontSize: 12,
        margin: [0, 0, 0, 10]
      },
      tableHeader: {
        fontSize: 12,
        bold: true,
        fillColor: '#f0f0f0'
      },
      tableCell: {
        fontSize: 12
      },
      footer: {
        fontSize: 12,
        bold: true,
        italics: true
      }
    },
    defaultStyle: {
      font: 'Roboto'
    }
  };

  try {
    pdfMake.createPdf(docDefinition).download('INNBC_AI_Agent_Report.pdf');
  } catch (error) {
    console.error('Failed to generate PDF:', error);
    alert('Failed to generate PDF. Please try again.');
  }
}

// Ensure event listeners
document.getElementById('download-pdf').addEventListener('click', downloadPDF);
document.getElementById('search-button').addEventListener('click', handleSearch);
document.getElementById('clear-button').addEventListener('click', handleClear);