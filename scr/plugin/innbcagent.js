// CHANGE: Updated summarizePaper to accept query parameter and note missing terms
// CHANGE: Updated summarizePaper prompt to generate a longer, more detailed report with mechanistic insights, study details, and research implications
export async function summarizePaper(content, query) {
  try {
    console.log('summarizePaper input:', content.slice(0, 200) + '...');
    if (!content.trim()) {
      console.warn('Empty input received, returning default report');
      return JSON.stringify({
        title: 'Report on Empty Input',
        abstract: `No input provided for query "${query}". Unable to generate a scientific report.`,
        introduction: 'The task requires input data, but none was supplied.',
        results: 'No results available due to lack of input.',
        conclusions: 'No conclusions can be drawn without input.',
        references: [],
        nonMedicalQuery: false // NEW CHANGE MADE: Added nonMedicalQuery for empty input case, set to false
      });
    }
    
    async function trySummarize(content, retries = 2) {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const response = await fetch('/api/grok', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'grok-3-mini',
              messages: [
                {
                  role: 'system',
                  content: `You are a bioresearch assistant. Based on the provided input (PubMed papers, PMC full-text, or user queries), 
                  generate a detailed scientific report as a JSON object with fields: "title" (string, concise and query-focused), "abstract" 
                  (string, must be 200-300 words, summarizing key findings, context, and implications), "introduction" (string, must be 300-400 words, 
                  providing background, query context, and biological mechanisms), "results" (string, must be 400-600 words and strongly aim for 550-600 
                  words when data permits, detailing study findings, designs, and comparisons), and "conclusions" (string, must be 300-400 words and strongly 
                  aim for 350-400 words when data permits, discussing implications, limitations, and future research). Do not generate references or citations, 
                  as they will be provided separately. The original query is: "${query}". If PubMed data is provided, summarize each study accurately, 
                  including study design (e.g., population, intervention, duration, without numerical study design details like group sizes), 
                  outcomes, and mechanistic insights (e.g., pathways like IGF-1, ghrelin). Synthesize findings across studies, comparing human and animal data 
                  if applicable. If query terms are missing, note this in the abstract and conclusions, and use available data or general knowledge without 
                  fabricating results. Include detailed context (e.g., disease background, intervention mechanisms) and discuss limitations, potential side effects, 
                  and research gaps. If the query is non-biomedical (e.g., engineering, physics) or the provided input is irrelevant to the query, use general 
                  knowledge to address the query, focusing on technical principles, historical developments, or applications relevant to the topic, set "nonMedicalQuery" to true, 
                  and note the absence of query-specific data in the abstract and conclusions. Ensure JSON is valid, complete, and focused on the query. Return only the 
                  JSON object. Do not include word counts, metadata, or annotations in the generated text; return only the scientific report content in the JSON object.`
                  
                },
                {
                  role: 'user',
                  content: `Generate a scientific report based on the following input: "${content}"`
                }
              ],
              max_tokens: 3800,
              temperature: 0.7,
              response_format: { type: 'json_object' }
            }),
          });
          const data = await response.json();
          console.log('summarizePaper API response:', data);
          const resultContent = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '';
          console.log('summarizePaper raw content:', resultContent || 'No content');
          if (!response.ok) {
            console.error('summarizePaper API error:', { status: response.status, statusText: response.statusText, data });
            throw new Error(data.error?.message || `HTTP ${response.status}: ${response.statusText}`);
          }
          //change
          if (!resultContent) {
            console.warn('No content or reasoning_content returned from API');
            throw new Error('No content returned from API');
          }
          JSON.parse(resultContent); // Validate JSON
          return resultContent;
          //end change
        } catch (error) {
          console.warn(`summarizePaper attempt ${attempt} failed:`, error);
          if (attempt === retries) {
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    return await trySummarize(content);
  } catch (error) {
    console.error('Grok summarization error:', error);
    throw error;
  }
}
// CHANGE: Updated extractTableData signature to accept query parameter
export async function extractTableData(text, query) {
  try {
    console.log('extractTableData input:', text.slice(0, 200) + '...');
    if (!text.trim()) {
      console.warn('Empty table input, returning null');
      return null;
    }
    const maxInputLength = 4000;
    const inputText = text.length > maxInputLength ? text.slice(0, maxInputLength) + '...' : text;

    const response = await fetch('/api/grok', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'grok-3-mini',
        messages: [
          {
            role: 'system',
            content: `Extract numerical data from the provided scientific text (e.g., PubMed abstracts, PMC full-text) relevant to the query "${query}". 
            Return a JSON object with "labels" (array of strings, describing the data context), "values" (array of numbers only, no strings or text), 
            and "units" (array of strings, specifying measurement units or "none" if unitless). Extract only explicit numerical values and their units 
            as they appear in the text (e.g., "50 IU/L" to 50, unit: "IU/L"; "39% increase" to 39, unit: "%"; "RR 0.5" to 0.5, unit: "none"). Try strongly to 
            extract up to 10 numerical values when possible. If units are not stated, infer them using standard scientific conventions (e.g., relative changes in %). Include only metrics relevant to the query, 
            including outcomes from human or animal studies if they pertain to the query's subject or focus and include primary outcomes, key performance indicators, 
            and comparative metrics critical for query context (e.g., treatment vs. control outcomes for biomedical queries, efficiency metrics for engineering). 
            Ensure comprehensive query coverage by including metrics in comparative phrases (e.g., "compared to X%"). Exclude study design details 
            (e.g., group sizes, p-values), metrics for interventions or subjects not specified in the query (e.g., other compounds or treatments), 
            and metrics without explicit numerical values (e.g., "increased BMD" without a number). Do not include commentary, error messages, 
            speculative values, or any non-JSON text. Ensure "labels", "values", and "units" arrays have identical lengths. If no valid numerical data is found, 
            return null. Return only valid JSON, with no trailing text or comments. Example: {"labels": ["Parameter A change", "Parameter B level"], 
            "values": [25, 100], "units": ["%", "mmol/L"]}`
          },
          {
            role: 'user',
            content: `Extract numerical data from the following text: "${inputText}"`
          }
        ],
        max_tokens: 4000,
        temperature: 0.7, // Lowered from 0.7 to reduce model creativity
        response_format: { type: 'json_object' }
      }),
    });
    const data = await response.json();
    console.log('extractTableData API response:', { status: response.status, data });
    //change
    const resultContent = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '';
    console.log('extractTableData raw content:', resultContent || 'No content');
    if (!response.ok) {
      console.error('extractTableData API error:', { status: response.status, statusText: response.statusText, data });
      throw new Error(data.error?.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    //start change -- fallback 
    if (!resultContent || resultContent === 'null' || !resultContent.trim()) {
      console.warn('No valid table data returned from API');
      return null;
    }
    // Clean up potential trailing commentary
    let cleanedResult = resultContent;
    const lastBraceIndex = cleanedResult.lastIndexOf('}');
    if (lastBraceIndex !== -1) {
      cleanedResult = cleanedResult.substring(0, lastBraceIndex + 1);
    }
    cleanedResult = cleanedResult.trim().replace(/\n+/g, '');
    let parsed;
    try {
      parsed = JSON.parse(resultContent);
    } catch (error) {
      console.error('JSON parsing error for extractTableData:', error, 'Raw content:', resultContent);
      let fixedResult = cleanedResult;
      if (!fixedResult.endsWith('}')) {
        fixedResult += '}';
      }
      if (!fixedResult.startsWith('{')) {
        fixedResult = '{' + fixedResult;
      }
      try {
        parsed = JSON.parse(fixedResult);
      } catch (fixError) {
        console.error('Failed to fix partial JSON:', fixError);
        return null;
      }
    }
    if (!parsed || !parsed.labels || !parsed.values || !parsed.units || 
      parsed.labels.length !== parsed.values.length || 
      parsed.labels.length !== parsed.units.length) {
      console.error('extractTableData: Expected matching labels, values, units arrays, got:', parsed);
      return null;
    }
    // Validate that values contains only numbers
    if (!parsed.values.every(val => typeof val === 'number' && !isNaN(val))) {
    console.error('extractTableData: Values array contains non-numeric entries:', parsed.values);
    return null;
  }
  return parsed;
} catch (error) {
  console.error('Grok table extraction error:', error);
  return null;
}
}
