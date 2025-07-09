const { createReactAgent } = require('@langchain/langgraph/prebuilt');
const { ChatOpenAI } = require('@langchain/openai');
const { tool } = require('@langchain/core/tools');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const { z } = require('zod');
const { acquirePage, releasePage } = require('../service/browserpool');
const captureImages = require('./image');
const cheerio = require('cheerio');

const SelectorResponseSchema = z.object({
  selector: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  alternatives: z.array(z.string()).optional()
});


// Get visual context
const getVisualContext = async (page) => {
  return await page.evaluate(() => {
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };
    
    const scrollPosition = {
      x: window.pageXOffset,
      y: window.pageYOffset
    };
    
    return {
      viewport,
      scrollPosition,
      documentHeight: document.documentElement.scrollHeight,
      documentWidth: document.documentElement.scrollWidth
    };
  });
};

// Apply semantic filtering with enhanced context understanding
const applySemanticFiltering = (htmlStructure, elementDescription, semanticAnalysis) => {
  console.log(`🎯 Semantic filtering: "${elementDescription}"`);
  const descriptionLower = elementDescription.toLowerCase();
  const keywords = extractKeywords(descriptionLower);
  console.log(`📝 Extracted keywords: [${keywords.join(', ')}]`);
  
  // First, check if the description matches any headings or sections
  const matchingHeadings = [];
  const matchingElements = [];
  
  // Look for matching headings
  if (semanticAnalysis.headings) {
    console.log(`🔍 Checking ${semanticAnalysis.headings.length} headings for matches...`);
    semanticAnalysis.headings.forEach(heading => {
      const headingMatch = calculateTextMatch(heading.text, descriptionLower);
      if (headingMatch > 0.3) { // 30% match threshold
        console.log(`✅ Heading match found: "${heading.text}" (score: ${headingMatch.toFixed(2)})`);
        matchingHeadings.push({
          ...heading,
          matchScore: headingMatch,
          type: 'heading'
        });
        
        // Add associated content for matching headings
        console.log(`📄 Adding ${heading.associatedContent.length} content elements for heading: "${heading.text}"`);
        heading.associatedContent.forEach(content => {
          matchingElements.push({
            selectors: [content.selector],
            tagName: content.tagName,
            classes: content.className,
            id: content.id,
            text: content.text,
            importance: 50 + (headingMatch * 30), // High importance for heading content
            type: 'heading-content',
            parentHeading: heading.text,
            matchScore: headingMatch
          });
        });
      }
    });
  }
  
  // Look for matching sections
  if (semanticAnalysis.sections) {
    console.log(`🔍 Checking ${semanticAnalysis.sections.length} sections for matches...`);
    semanticAnalysis.sections.forEach(section => {
      const sectionMatch = calculateTextMatch(section.headings.join(' '), descriptionLower) || 
                          calculateTextMatch(section.textContent, descriptionLower);
      if (sectionMatch > 0.2) { // 20% match threshold for sections
        console.log(`✅ Section match found: "${section.headings.join(', ')}" (score: ${sectionMatch.toFixed(2)})`);
        matchingElements.push({
          selectors: [section.selector],
          tagName: section.tagName,
          classes: section.className,
          id: section.id,
          text: section.textContent,
          importance: 40 + (sectionMatch * 25),
          type: 'section',
          headings: section.headings,
          matchScore: sectionMatch
        });
      }
    });
  }
  
  // Apply original smart filtering
  console.log(`🔄 Applying original smart filtering to ${htmlStructure.length} elements...`);
  const originalFiltered = applySmartFiltering(htmlStructure, elementDescription);
  console.log(`✅ Original filtering found ${originalFiltered.length} elements`);
  
  // Combine and rank results
  console.log(`🔗 Combining semantic matches (${matchingElements.length}) with original filtering (${originalFiltered.length})`);
  const combinedResults = [...matchingElements, ...originalFiltered];
  
  // Remove duplicates and sort by relevance
  const uniqueResults = combinedResults.filter((item, index, self) => 
    index === self.findIndex(t => t.selectors && t.selectors[0] === item.selectors?.[0])
  );
  console.log(`🎯 Final filtered results: ${uniqueResults.length} unique elements`);
  
  const sortedResults = uniqueResults.sort((a, b) => {
    const aScore = (a.matchScore || 0) * 100 + (a.importance || 0);
    const bScore = (b.matchScore || 0) * 100 + (b.importance || 0);
    return bScore - aScore;
  });
  
  // Log top results
  console.log(`🏆 Top 3 semantic filtering results:`);
  sortedResults.slice(0, 3).forEach((result, index) => {
    const selector = result.selectors?.[0] || 'unknown';
    const score = ((result.matchScore || 0) * 100 + (result.importance || 0)).toFixed(1);
    const type = result.type || 'unknown';
    console.log(`  ${index + 1}. ${selector} (${type}, score: ${score})`);
  });
  
  return sortedResults;
};

// Calculate text match between query and content
const calculateTextMatch = (text, query) => {
  if (!text || !query) return 0;
  
  const textLower = text.toLowerCase();
  const queryWords = query.split(' ').filter(word => word.length > 2);
  
  let matchScore = 0;
  let totalWords = queryWords.length;
  
  queryWords.forEach(word => {
    if (textLower.includes(word)) {
      matchScore += 1;
    }
    
    // Check for partial matches
    const textWords = textLower.split(' ');
    textWords.forEach(textWord => {
      if (textWord.includes(word) || word.includes(textWord)) {
        matchScore += 0.5;
      }
    });
  });
  
  return Math.min(matchScore / totalWords, 1);
};

// Apply smart filtering based on element description (original function)
const applySmartFiltering = (htmlStructure, elementDescription) => {
  const descriptionLower = elementDescription.toLowerCase();
  const keywords = extractKeywords(descriptionLower);
  
  return htmlStructure.filter(element => {
    let relevanceScore = 0;
    
    // Check text content
    if (element.text) {
      const textLower = String(element.text).toLowerCase();
      keywords.forEach(keyword => {
        if (textLower.includes(keyword)) {
          relevanceScore += 10;
        }
      });
    }
    
    // Check classes
    if (element.classes) {
      const classesLower = String(element.classes).toLowerCase();
      keywords.forEach(keyword => {
        if (classesLower.includes(keyword)) {
          relevanceScore += 15;
        }
      });
    }
    
    // Check ID
    if (element.id) {
      const idLower = String(element.id).toLowerCase();
      keywords.forEach(keyword => {
        if (idLower.includes(keyword)) {
          relevanceScore += 20;
        }
      });
    }
    
    // Check tag name relevance
    const tagRelevance = getTagRelevance(element.tagName, descriptionLower);
    relevanceScore += tagRelevance;
    
    return relevanceScore > 0;
  }).sort((a, b) => {
    // Sort by combined relevance and importance
    const aScore = calculateRelevanceScore(a, keywords) + a.importance;
    const bScore = calculateRelevanceScore(b, keywords) + b.importance;
    return bScore - aScore;
  });
};

// Extract keywords from description
const extractKeywords = (description) => {
  const keywords = [];
  
  // Direct keywords
  const words = description.split(' ').filter(word => word.length > 2);
  keywords.push(...words);
  
  // Semantic mappings
  const semanticMap = {
    'hero': ['hero', 'banner', 'jumbotron', 'intro', 'main'],
    'navigation': ['nav', 'menu', 'navbar', 'navigation'],
    'pricing': ['pricing', 'plans', 'price', 'cost', 'billing'],
    'footer': ['footer', 'bottom'],
    'header': ['header', 'top', 'banner'],
    'content': ['content', 'main', 'article', 'section'],
    'sidebar': ['sidebar', 'aside', 'side'],
    'testimonials': ['testimonials', 'reviews', 'feedback'],
    'features': ['features', 'benefits', 'advantages'],
    'about': ['about', 'company', 'story', 'mission'],
    'contact': ['contact', 'reach', 'connect', 'support']
  };
  
  Object.entries(semanticMap).forEach(([key, values]) => {
    if (description.includes(key)) {
      keywords.push(...values);
    }
  });
  
  return [...new Set(keywords)];
};

// Get tag relevance for description
const getTagRelevance = (tagName, description) => {
  const tagRelevanceMap = {
    'header': ['header', 'top', 'banner'],
    'nav': ['nav', 'navigation', 'menu'],
    'main': ['main', 'content', 'primary'],
    'section': ['section', 'area', 'part'],
    'article': ['article', 'content', 'post'],
    'aside': ['sidebar', 'aside', 'side'],
    'footer': ['footer', 'bottom'],
    'form': ['form', 'input', 'contact'],
    'table': ['table', 'data', 'pricing'],
    'figure': ['image', 'figure', 'gallery'],
    'h1': ['title', 'heading', 'main'],
    'h2': ['subtitle', 'heading', 'section'],
    'h3': ['heading', 'subsection']
  };
  
  const relevantTerms = tagRelevanceMap[tagName] || [];
  return relevantTerms.some(term => description.includes(term)) ? 10 : 0;
};

// Calculate relevance score
const calculateRelevanceScore = (element, keywords) => {
  let score = 0;
  
  keywords.forEach(keyword => {
    if (element.text && String(element.text).toLowerCase().includes(keyword)) {
      score += 8;
    }
    if (element.classes && String(element.classes).toLowerCase().includes(keyword)) {
      score += 12;
    }
    if (element.id && String(element.id).toLowerCase().includes(keyword)) {
      score += 15;
    }
  });
  
  return score;
};

// ENHANCED SELECTOR FINDING WITH ACTUAL CONTENT ANALYSIS
// This improvement addresses the core issue where the LLM was making decisions based on structural metadata
// rather than understanding the actual content each selector would capture.
// 
// Key improvements:
// 1. getSelectorContent() - Extracts actual text content, headings, links, buttons, and semantic indicators
// 2. Enhanced LLM prompt with actualContent field showing exactly what each selector captures
// 3. Content-aware scoring that prioritizes selectors based on text matches and semantic alignment
// 4. Validation with actual content analysis for better accuracy
//
// This ensures the agent can understand what data each selector holds and make better decisions.

// Get actual content for each selector to help LLM understand what it would capture
const getSelectorContent = async (page, selector) => {
  try {
    const content = await page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (!element) return null;

      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      // Get clean text content
      const textContent = element.textContent?.trim() || '';

      // Get visible text (excluding hidden elements)
      const getVisibleText = (el) => {
        let text = '';
        for (let node of el.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent?.trim() + ' ';
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const childStyle = window.getComputedStyle(node);
            if (childStyle.display !== 'none' && childStyle.visibility !== 'hidden') {
              text += getVisibleText(node);
            }
          }
        }
        return text.trim();
      };

      const visibleText = getVisibleText(element);

      // Get structure info
      const headings = Array.from(element.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
        level: h.tagName.toLowerCase(),
        text: h.textContent?.trim() || ''
      }));

      const links = Array.from(element.querySelectorAll('a')).slice(0, 5).map(a => ({
        text: a.textContent?.trim() || '',
        href: a.href || ''
      }));

      const images = Array.from(element.querySelectorAll('img')).slice(0, 3).map(img => ({
        alt: img.alt || '',
        src: img.src || ''
      }));

      const buttons = Array.from(element.querySelectorAll('button, input[type="button"], input[type="submit"]')).slice(0, 3).map(btn => ({
        text: btn.textContent?.trim() || btn.value || '',
        type: btn.type || 'button'
      }));

      // Get semantic indicators
      const semanticIndicators = [];
      if (element.querySelector('[class*="pricing"], [class*="price"], [class*="plan"]')) {
        semanticIndicators.push('pricing');
      }
      if (element.querySelector('[class*="hero"], [class*="banner"], [class*="jumbotron"]')) {
        semanticIndicators.push('hero');
      }
      if (element.querySelector('[class*="nav"], [class*="menu"]')) {
        semanticIndicators.push('navigation');
      }
      if (element.querySelector('[class*="footer"]')) {
        semanticIndicators.push('footer');
      }
      if (element.querySelector('[class*="feature"], [class*="benefit"]')) {
        semanticIndicators.push('features');
      }
      if (element.querySelector('[class*="testimonial"], [class*="review"]')) {
        semanticIndicators.push('testimonials');
      }
      if (element.querySelector('[class*="about"], [class*="story"]')) {
        semanticIndicators.push('about');
      }
      if (element.querySelector('[class*="contact"], [class*="reach"]')) {
        semanticIndicators.push('contact');
      }

      return {
        isVisible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
        dimensions: {
          width: rect.width,
          height: rect.height,
          area: rect.width * rect.height
        },
        textContent: textContent.substring(0, 800), // Increased limit
        visibleText: visibleText.substring(0, 800), // Get clean visible text
        wordCount: visibleText.split(/\s+/).filter(word => word.length > 0).length,
        headings,
        links,
        images,
        buttons,
        semanticIndicators,
        containsText: (query) => {
          const searchIn = (textContent + ' ' + visibleText).toLowerCase();
          return query.toLowerCase().split(' ').some(word =>
            word.length > 2 && searchIn.includes(word)
          );
        }
      };
    }, selector);

    return content;
  } catch (error) {
    return null;
  }
};

// Enhanced LLM-based selector finding with actual content analysis
const findBestSelectorWithEnhancedLLM = async (filteredElements, visualContext, elementDescription, semanticAnalysis, page) => {
  const llm = new ChatOpenAI({
    modelName: 'gpt-4.1',
    temperature: 0.1,
    openAIApiKey: process.env.OPENAI_API_KEY,
  }).withStructuredOutput(SelectorResponseSchema);

  // Get actual content for top selector candidates
  console.log('🔍 Getting actual content for top selector candidates...');
  const topCandidates = filteredElements.slice(0, 10); // Analyze top 10 candidates
  const candidatesWithContent = [];

  for (const candidate of topCandidates) {
    const primarySelector = candidate.selectors?.[0];
    if (primarySelector) {
      const content = await getSelectorContent(page, primarySelector);
      if (content && content.isVisible) {
        candidatesWithContent.push({
          ...candidate,
          actualContent: content
        });
      }
    }
  }

  console.log(`✅ Retrieved content for ${candidatesWithContent.length} candidates`);

  // Extract relevant headings and sections for context
  const relevantHeadings = semanticAnalysis.headings?.filter(h => 
    calculateTextMatch(h.text, elementDescription) > 0.2
  ) || [];
  
  const relevantSections = semanticAnalysis.sections?.filter(s => 
    calculateTextMatch(s.headings.join(' '), elementDescription) > 0.2 ||
    calculateTextMatch(s.textContent, elementDescription) > 0.2
  ) || [];

  const systemPrompt = `You are an expert CSS selector analyst for web automation with deep understanding of page semantics. Your task is to find the most accurate and reliable CSS selector for the requested element.
  These selector will be used to take a screenshot of the element. Make sure that the selector you find is best for taking a screenshot of the element.

CRITICAL UNIQUENESS REQUIREMENT:
- The selector MUST target exactly ONE element on the page
- If multiple elements share the same class, you MUST use structural selectors to make it unique
- Use nth-child(), nth-of-type(), or parent > child relationships to ensure uniqueness
- NEVER return a selector that could match multiple elements

ANALYSIS CONTEXT:
- Element Description: "${elementDescription}"
- Viewport: ${visualContext.viewport.width}x${visualContext.viewport.height}
- Available Elements: ${candidatesWithContent.length} relevant elements found with actual content

SEMANTIC CONTEXT:
Page Headings (that may be relevant):
${JSON.stringify(relevantHeadings, null, 2)}

Page Sections (that may be relevant):
${JSON.stringify(relevantSections, null, 2)}

ENHANCED ELEMENT DATA WITH ACTUAL CONTENT:
Each element now includes actualContent field showing exactly what content the selector would capture:
- actualContent.textContent: Complete text content that would be captured
- actualContent.visibleText: Only visible text (excluding hidden elements)
- actualContent.headings: All headings within the element
- actualContent.links: All links within the element
- actualContent.images: All images within the element
- actualContent.buttons: All buttons within the element
- actualContent.semanticIndicators: Detected semantic content types (pricing, hero, nav, etc.)
- actualContent.dimensions: Exact width, height, and area
- actualContent.wordCount: Number of words in the element

CANDIDATES WITH ACTUAL CONTENT (most relevant first):
${JSON.stringify(candidatesWithContent.map(candidate => ({
  selectors: candidate.selectors,
  tagName: candidate.tagName,
  classes: candidate.classes,
  id: candidate.id,
  importance: candidate.importance,
  actualContent: candidate.actualContent,
  reliability: candidate.reliability,
  position: candidate.position
})), null, 2)}

INTELLIGENT SELECTION STRATEGY:
1. **Content Match**: Analyze actualContent.textContent and actualContent.visibleText to see if they match the "${elementDescription}"
2. **Semantic Indicators**: Use actualContent.semanticIndicators to identify content types
3. **Structural Content**: Examine actualContent.headings, links, buttons to understand element purpose
4. **Text Quality**: Consider actualContent.wordCount and content density
5. **Visual Suitability**: Use actualContent.dimensions for screenshot quality

ENHANCED MATCHING CRITERIA:
- **Direct Content Match**: Does actualContent.textContent contain keywords from "${elementDescription}"?
- **Semantic Content**: Do actualContent.semanticIndicators match the query intent?
- **Structural Relevance**: Do actualContent.headings align with the requested section?
- **Interactive Elements**: Are there relevant actualContent.buttons or actualContent.links?
- **Content Density**: Is actualContent.wordCount appropriate for the requested element?

SELECTION PRIORITY (weighted scoring):
1. **Content Relevance** (35%): actualContent directly matches the description
2. **Uniqueness Score** (30%): selector must target exactly one element
3. **Semantic Match** (20%): actualContent.semanticIndicators align with query
4. **Visual Suitability** (10%): appropriate dimensions for screenshots
5. **Reliability Score** (5%): stability indicators

CRITICAL ANALYSIS QUESTIONS:
- Which element's actualContent.textContent best matches "${elementDescription}"?
- Which element's actualContent.semanticIndicators align with the query intent?
- Which element's actualContent.headings contain relevant section information?
- Which element has the most appropriate actualContent.dimensions for a screenshot?

RETURN FORMAT:
- selector: The best CSS selector (MUST be unique)
- confidence: 0.0-1.0 (weighted by content match, uniqueness, and semantic alignment)
- reasoning: Detailed explanation focusing on how actualContent matches the description
- alternatives: 2-3 alternative unique selectors as backup

CRITICAL RULES:
- ALWAYS analyze the actualContent to understand what each selector would capture
- Prefer selectors whose actualContent directly contains the requested information
- Consider actualContent.semanticIndicators for content type matching
- Use actualContent.headings for section-based queries
- Factor in actualContent.dimensions for screenshot quality
- NEVER use :contains(), :has(), :is(), :where() pseudo-classes
- Base decisions on actual content, not just metadata`;

  const response = await llm.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(`Find the best UNIQUE CSS selector for: "${elementDescription}"
    
Context: I need to find and screenshot the element that represents "${elementDescription}" on this page. 

CRITICAL: Use the ACTUAL CONTENT analysis provided above to make your decision:
1. **Content Analysis**: Examine each candidate's actualContent.textContent and actualContent.visibleText to see which one actually contains the requested information
2. **Semantic Matching**: Check actualContent.semanticIndicators to identify content types (pricing, hero, navigation, etc.)
3. **Structure Analysis**: Use actualContent.headings to understand section content
4. **Interactive Elements**: Consider actualContent.buttons and actualContent.links for functionality
5. **Content Quality**: Evaluate actualContent.wordCount and content density

The actualContent field shows you EXACTLY what text and elements each selector would capture. This is the most important factor for selection.

Answer these questions in your reasoning:
- Which candidate's actualContent.textContent most closely matches "${elementDescription}"?
- Which candidate's actualContent.semanticIndicators align with the query type?
- Which candidate has the most relevant actualContent.headings?
- Which candidate has appropriate actualContent.dimensions for a good screenshot?

Base your selection on the actual content that would be captured, not just structural metadata.`)
  ]);

  return response;
};


const createScreenshotTools = (agentInstance) => {
  const tools = [
    tool(
      async ({ url }) => {
        try {
          console.log(`🛠️ TOOL: navigate_to_url called with: "${url}"`);
          if (agentInstance.currentPage) {
            await releasePage(agentInstance.currentPage);
          }
          agentInstance.currentPage = await acquirePage();
          await agentInstance.currentPage.setViewport({ width: 1280, height: 720 });
          console.log(`🌐 Navigating to: ${url}`);
          await agentInstance.currentPage.goto(url, { waitUntil: ['domcontentloaded', 'networkidle0'], timeout: 15000 });
          await agentInstance.currentPage.waitForTimeout(2500);
          console.log(`✅ Successfully navigated to: ${url}`);
          return `Successfully navigated to ${url}. Page is now loaded and ready for analysis.`;
        } catch (error) {
          console.error(`❌ TOOL: navigate_to_url failed:`, error);
          return `Failed to navigate to ${url}: ${error.message}`;
        }
      },
      {
        name: 'navigate_to_url',
        description: 'Navigate to a specific URL. Use this to start by going to a website homepage.',
        schema: z.object({
          url: z.string().describe('The URL to navigate to (e.g., https://slack.com)')
        })
      }
    ),

    tool(
      async () => {
        try {
          console.log(`🛠️ TOOL: analyze_current_page called`);
          if (!agentInstance.currentPage) {
            return "No page is currently loaded. Please navigate to a URL first.";
          }
          
          console.log(`📄 Analyzing page content...`);
          const content = await agentInstance.currentPage.content();
          const $ = cheerio.load(content);
          
          const title = $('title').text().trim();
          
          const headings = [];
          $('h1, h2, h3').each((i, el) => {
            if (i < 10) headings.push($(el).text().trim());
          });
          
          const navLinks = [];
          $('nav a, header a, .nav a, .navbar a, .menu a').each((i, el) => {
            if (i < 15) {
              const href = $(el).attr('href');
              const text = $(el).text().trim();
              if (href && text) {
                navLinks.push({ text, href });
              }
            }
          });
          
          const importantLinks = [];
          $('a').each((i, el) => {
            if (i < 50) {
              const href = $(el).attr('href');
              const text = $(el).text().trim();
              if (href && text && (
                text.toLowerCase().includes('pricing') ||
                text.toLowerCase().includes('price') ||
                text.toLowerCase().includes('plans') ||
                text.toLowerCase().includes('about') ||
                text.toLowerCase().includes('contact') ||
                text.toLowerCase().includes('product') ||
                text.toLowerCase().includes('features')
              )) {
                importantLinks.push({ text, href });
              }
            }
          });
          
          const currentUrl = agentInstance.currentPage.url();
          
          console.log(`✅ Page analysis complete: ${headings.length} headings, ${navLinks.length} nav links, ${importantLinks.length} important links`);
          
          return JSON.stringify({
            title,
            currentUrl,
            headings,
            navLinks,
            importantLinks
          }, null, 2);
        } catch (error) {
          console.error(`❌ TOOL: analyze_current_page failed:`, error);
          return `Failed to analyze page: ${error.message}`;
        }
      },
      {
        name: 'analyze_current_page',
        description: 'Analyze the current page content, extract titles, headings, and important links.',
        schema: z.object({})
      }
    ),

    tool(
      async ({ linkText, linkHref }) => {
        try {
          console.log(`🛠️ TOOL: click_link called with: "${linkText}" (${linkHref})`);
          if (!agentInstance.currentPage) {
            return "No page is currently loaded. Please navigate to a URL first.";
          }
          
          // Find the link element using both text and href with flexible matching
          const linkFound = await agentInstance.currentPage.evaluate((text, href) => {
            const links = Array.from(document.querySelectorAll('a'));
            
            // Normalize text for comparison (remove extra whitespace, newlines)
            const normalizeText = (str) => {
              return str.replace(/\s+/g, ' ').trim();
            };
            
            const normalizedSearchText = normalizeText(text);
            let matchingLink = null;
            let debugInfo = [];
            
            // Try different matching strategies
            for (const link of links) {
              const linkText = normalizeText(link.textContent || '');
              const linkHref = link.getAttribute('href') || '';
              
              debugInfo.push({
                text: linkText,
                href: linkHref,
                originalText: link.textContent?.substring(0, 100) || ''
              });
              
              // Strategy 1: Exact match after normalization
              if (linkText === normalizedSearchText && linkHref === href) {
                matchingLink = link;
                break;
              }
              
              // Strategy 2: Href match with partial text match
              if (linkHref === href && linkText.includes(normalizedSearchText.split(' ')[0])) {
                matchingLink = link;
                break;
              }
              
              // Strategy 3: Just href match if text is very close
              if (linkHref === href && normalizedSearchText.length > 10) {
                const similarity = linkText.length > 0 ? 
                  normalizedSearchText.split(' ').filter(word => linkText.includes(word)).length / normalizedSearchText.split(' ').length : 0;
                if (similarity > 0.5) {
                  matchingLink = link;
                  break;
                }
              }
            }
            
            if (matchingLink) {
              const rect = matchingLink.getBoundingClientRect();
              const computedStyle = window.getComputedStyle(matchingLink);
              
              // More comprehensive visibility check
              const isVisible = computedStyle.display !== 'none' && 
                               computedStyle.visibility !== 'hidden' &&
                               computedStyle.opacity !== '0' &&
                               rect.width > 0 && rect.height > 0;
              
              return {
                found: true,
                selector: matchingLink.id ? `#${matchingLink.id}` : 
                         matchingLink.className ? `a.${matchingLink.className.split(' ')[0]}` :
                         `a[href="${href}"]`,
                visible: isVisible,
                position: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
                computedStyle: {
                  display: computedStyle.display,
                  visibility: computedStyle.visibility,
                  opacity: computedStyle.opacity
                },
                actualText: normalizeText(matchingLink.textContent || ''),
                debugInfo: debugInfo.slice(0, 5) // First 5 links for debugging
              };
            }
            return { found: false, debugInfo: debugInfo.slice(0, 5) };
          }, linkText, linkHref);
          
          if (!linkFound.found) {
            const debugText = linkFound.debugInfo?.map(info => 
              `Text: "${info.text.substring(0, 50)}..." | Href: "${info.href}"`
            ).join('\n') || 'No links found';
            
            return `Failed to find link with text "${linkText}" and href "${linkHref}" on the page.\n\nAvailable links:\n${debugText}`;
          }
          
          if (!linkFound.visible) {
            const styleInfo = linkFound.computedStyle ? 
              `CSS: display=${linkFound.computedStyle.display}, visibility=${linkFound.computedStyle.visibility}, opacity=${linkFound.computedStyle.opacity}` : 
              'No style info';
            
            console.log(`⚠️ Link not visible, but attempting to click anyway...`);
            console.log(`Link details: ${JSON.stringify(linkFound.position)}, ${styleInfo}`);
            
            // Try to scroll to the element first
            try {
              await agentInstance.currentPage.evaluate((selector) => {
                const element = document.querySelector(selector);
                if (element) {
                  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }, linkFound.selector);
              
              await agentInstance.currentPage.waitForTimeout(1000);
              
              // Check visibility again after scrolling
              const recheckedVisibility = await agentInstance.currentPage.evaluate((selector) => {
                const element = document.querySelector(selector);
                if (!element) return false;
                
                const rect = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);
                
                return style.display !== 'none' && 
                       style.visibility !== 'hidden' &&
                       style.opacity !== '0' &&
                       rect.width > 0 && rect.height > 0;
              }, linkFound.selector);
              
              if (!recheckedVisibility) {
                console.log(`⚠️ Still not visible after scrolling, but proceeding with click attempt...`);
              }
            } catch (scrollError) {
              console.log(`⚠️ Scroll attempt failed, proceeding with click: ${scrollError.message}`);
            }
          }
          
          // Store current URL to detect navigation
          const currentUrl = agentInstance.currentPage.url();
          
          // Actually click the link element
          console.log(`🖱️ Clicking link element: ${linkFound.selector}`);
          await agentInstance.currentPage.click(linkFound.selector);
          
          // Wait for potential navigation or page changes
          try {
            await agentInstance.currentPage.waitForFunction(
              (originalUrl) => window.location.href !== originalUrl,
              { timeout: 5000 },
              currentUrl
            );
            console.log(`🔄 Navigation detected after click`);
          } catch (timeoutError) {
            // No navigation occurred, which is fine for some links
            console.log(`⏰ No navigation detected, continuing...`);
          }
          
          // Wait a bit more for any dynamic content to load
          await agentInstance.currentPage.waitForTimeout(2000);
          
          const newUrl = agentInstance.currentPage.url();
          const navigationOccurred = newUrl !== currentUrl;
          
          console.log(`✅ Link click completed`);
          return `Successfully clicked link "${linkText}". ${navigationOccurred ? `Navigated to: ${newUrl}` : 'No navigation occurred (may be a same-page link or JavaScript action).'}`;
        } catch (error) {
          console.error(`❌ TOOL: click_link failed:`, error);
          return `Failed to click link: ${error.message}`;
        }
      },
      {
        name: 'click_link',
        description: 'Actually click on a specific link found on the current page. This will trigger any JavaScript behaviors and handle SPAs properly.',
        schema: z.object({
          linkText: z.string().describe('The text of the link to click'),
          linkHref: z.string().describe('The href attribute of the link')
        })
      }
    ),

    tool(
      async ({ elementDescription }) => {
        try {
          console.log(`🛠️ TOOL: find_element_selector called with: "${elementDescription}"`);
          if (!agentInstance.currentPage) {
            return "No page is currently loaded. Please navigate to a URL first.";
          }
          
          // Multi-step approach for better accuracy
          const selectorResult = await findBestSelectorMultiStep(agentInstance.currentPage, elementDescription);
          console.log(`🛠️ TOOL: find_element_selector completed successfully`);
          
          return JSON.stringify(selectorResult, null, 2);
        } catch (error) {
          console.error(`❌ TOOL: find_element_selector failed:`, error);
          return `Failed to find selector: ${error.message}`;
        }
      },
      {
        name: 'find_element_selector',
        description: 'Find the CSS selector for a specific element on the page with improved accuracy',
        schema: z.object({
          elementDescription: z.string().describe('Description of the element to find')
        })
      }
    ),

    tool(
      async ({ selector }) => {
        try {
          console.log(`🛠️ TOOL: take_screenshot called with selector: "${selector}"`);
          if (!agentInstance.currentPage) {
            return "No page is currently loaded. Please navigate to a URL first.";
          }
          
          // Add debugging before taking screenshot
          console.log(`🔍 Debugging selector before screenshot...`);
          const debugInfo = await agentInstance.debugSelector(selector);
          console.log('📊 debugInfo:', debugInfo);
          
          console.log(`📸 Starting image capture...`);
          const result = await captureImages({
            url: agentInstance.currentPage.url(),
            selector,
            width: 1280,
            height: 720,
            page: agentInstance.currentPage,
            fileExtension: 'png'
          });
          console.log(`✅ Screenshot captured successfully: ${result.url}`);
          
          return JSON.stringify({
            success: true,
            screenshot: result,
            debug: debugInfo,
            message: `Successfully captured screenshot using selector: ${selector}`
          }, null, 2);
        } catch (error) {
          console.error(`❌ TOOL: take_screenshot failed:`, error);
          return `Failed to take screenshot: ${error.message}`;
        }
      },
      {
        name: 'take_screenshot',
        description: 'Take a screenshot of the current page or specific element',
        schema: z.object({
          selector: z.string().describe('CSS selector for the element to screenshot')
        })
      }
    ),

    tool(
      async ({ selector }) => {
        try {
          if (!agentInstance.currentPage) {
            return "No page is currently loaded. Please navigate to a URL first.";
          }
          
          const debugInfo = await agentInstance.debugSelector(selector);
          return JSON.stringify(debugInfo, null, 2);
        } catch (error) {
          return `Failed to debug selector: ${error.message}`;
        }
      },
      {
        name: 'debug_selector',
        description: 'Debug a CSS selector to understand if it exists and is visible on the page',
        schema: z.object({
          selector: z.string().describe('CSS selector to debug')
        })
      }
    ),

    tool(
      async ({ headingText }) => {
        try {
          console.log(`🛠️ TOOL: find_section_by_heading called with: "${headingText}"`);
          if (!agentInstance.currentPage) {
            return "No page is currently loaded. Please navigate to a URL first.";
          }
          
          const sectionInfo = await agentInstance.findSectionByHeading(headingText);
          console.log(`🛠️ TOOL: find_section_by_heading completed - found ${sectionInfo.matchingHeadings?.length || 0} matching headings`);
          return JSON.stringify(sectionInfo, null, 2);
        } catch (error) {
          console.error(`❌ TOOL: find_section_by_heading failed:`, error);
          return `Failed to find section: ${error.message}`;
        }
      },
      {
        name: 'find_section_by_heading',
        description: 'Find a section of content by looking for a specific heading text (e.g., "nomenclature", "pricing", "about")',
        schema: z.object({
          headingText: z.string().describe('Text to look for in headings (e.g., "nomenclature", "pricing")')
        })
      }
    ),
    tool(
      async () => {
        try {
          console.log(`🛠️ TOOL: analyze_page_semantics called`);
          if (!agentInstance.currentPage) {
            return "No page is currently loaded. Please navigate to a URL first.";
          }
          
          const semanticAnalysis = await agentInstance.analyzePageSemantics();
          console.log(`🛠️ TOOL: analyze_page_semantics completed - found ${semanticAnalysis.headings?.length || 0} headings, ${semanticAnalysis.sections?.length || 0} sections`);
          return JSON.stringify(semanticAnalysis, null, 2);
        } catch (error) {
          console.error(`❌ TOOL: analyze_page_semantics failed:`, error);
          return `Failed to analyze page semantics: ${error.message}`;
        }
      },
      {
        name: 'analyze_page_semantics',
        description: 'Analyze the semantic structure of the page including sections, headings, and content relationships',
        schema: z.object({})
      }
    )
  ];

  return tools;
};

// Improved multi-step selector finding with semantic analysis
const findBestSelectorMultiStep = async (page, elementDescription) => {
  console.log(`🔍 Starting multi-step selector finding for: "${elementDescription}"`);
  
  // Step 1: Extract comprehensive HTML structure
  console.log('📋 Step 1: Extracting HTML structure...');
  const htmlStructure = await extractEnhancedHtmlStructure(page);
  console.log(`✅ Found ${htmlStructure.length} enhanced elements in HTML structure`);

  // Log structure insights
  const structureInsights = {
    semanticElements: htmlStructure.filter(el => el.reliability?.isSemanticElement).length,
    elementsWithStableIds: htmlStructure.filter(el => el.reliability?.hasStableId).length,
    interactiveElements: htmlStructure.filter(el => el.content?.interactivity !== 'static').length,
    landmarks: htmlStructure.filter(el => el.accessibility?.isLandmark).length,
    headings: htmlStructure.filter(el => el.accessibility?.isHeading).length
  };
  console.log(`📊 Structure insights: ${JSON.stringify(structureInsights)}`);
  
  // Step 2: Get visual context (element positions, sizes)
  console.log('🖼️ Step 2: Getting visual context...');
  const visualContext = await getVisualContext(page);
  console.log(`✅ Visual context: ${visualContext.viewport.width}x${visualContext.viewport.height}`);
  
  // Step 3: Get semantic analysis of the page
  console.log('🧠 Step 3: Performing semantic analysis...');
  const semanticAnalysis = await page.evaluate(() => {
    const result = {
      headings: [],
      sections: [],
      contentBlocks: []
    };

    // Extract all headings with their hierarchy and content
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    headings.forEach((heading, index) => {
      const level = parseInt(heading.tagName.charAt(1));
      const text = heading.textContent?.trim() || '';
      const id = heading.id || '';
      
      // Find content associated with this heading
      const associatedContent = [];
      let nextElement = heading.nextElementSibling;
      
      while (nextElement) {
        const nextTagName = nextElement.tagName.toLowerCase();
        
        // Stop if we hit another heading of same or higher level
        if (nextTagName.match(/^h[1-6]$/)) {
          const nextLevel = parseInt(nextTagName.charAt(1));
          if (nextLevel <= level) break;
        }
        
        // Collect content elements
        if (nextTagName === 'p' || nextTagName === 'div' || nextTagName === 'section' || 
            nextTagName === 'ul' || nextTagName === 'ol' || nextTagName === 'table') {
          const rect = nextElement.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            associatedContent.push({
              tagName: nextTagName,
              text: nextElement.textContent?.trim().substring(0, 200) || '',
              className: nextElement.className || '',
              id: nextElement.id || '',
              selector: nextElement.id ? `#${nextElement.id}` : 
                       (nextElement.className ? `${nextTagName}.${nextElement.className.split(' ')[0]}` : nextTagName)
            });
          }
        }
        
        nextElement = nextElement.nextElementSibling;
      }

      result.headings.push({
        level,
        text,
        id,
        className: heading.className || '',
        index,
        associatedContent,
        selector: id ? `#${id}` : `h${level}:nth-of-type(${index + 1})`,
        keywords: text.toLowerCase().split(' ').filter(word => word.length > 2)
      });
    });

    // Extract semantic sections
    const semanticSections = Array.from(document.querySelectorAll('section, article, main, aside, nav, header, footer'));
    semanticSections.forEach(section => {
      const rect = section.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const headingsInSection = Array.from(section.querySelectorAll('h1, h2, h3, h4, h5, h6'))
          .map(h => h.textContent?.trim() || '');
        
        result.sections.push({
          tagName: section.tagName.toLowerCase(),
          className: section.className || '',
          id: section.id || '',
          headings: headingsInSection,
          textContent: section.textContent?.trim().substring(0, 300) || '',
          selector: section.id ? `#${section.id}` : 
                   (section.className ? `${section.tagName.toLowerCase()}.${section.className.split(' ')[0]}` : section.tagName.toLowerCase()),
          keywords: headingsInSection.join(' ').toLowerCase().split(' ').filter(word => word.length > 2)
        });
      }
    });

    return result;
  });
  console.log(`✅ Semantic analysis complete: ${semanticAnalysis.headings?.length || 0} headings, ${semanticAnalysis.sections?.length || 0} sections`);
  
  // Step 4: Apply semantic filtering based on element description
  console.log('🎯 Step 4: Applying semantic filtering...');
  const filteredElements = applySemanticFiltering(htmlStructure, elementDescription, semanticAnalysis);
  console.log(`✅ Filtered to ${filteredElements.length} relevant elements`);
  
  // Enhanced filtering insights
  if (filteredElements.length > 0) {
    const filteringInsights = {
      avgImportance: (filteredElements.reduce((sum, el) => sum + el.importance, 0) / filteredElements.length).toFixed(1),
      semanticMatches: filteredElements.filter(el => el.content?.semanticRole !== 'unknown').length,
      stableSelectors: filteredElements.filter(el => el.reliability?.hasStableId || el.reliability?.isSemanticElement).length,
      interactiveElements: filteredElements.filter(el => el.content?.interactivity !== 'static').length,
      avgArea: filteredElements.reduce((sum, el) => sum + (el.position?.area || 0), 0) / filteredElements.length
    };
    console.log(`📈 Filtering insights: ${JSON.stringify(filteringInsights)}`);

    // Log top 3 candidates with detailed info
    console.log(`🏆 Top 3 candidates with enhanced data:`);
    filteredElements.slice(0, 3).forEach((el, index) => {
      const selector = el.selectors?.[0] || 'unknown';
      const role = el.content?.semanticRole || 'unknown';
      const reliability = el.reliability?.hasStableId ? 'stable' : 'unstable';
      const area = el.position?.area || 0;
      const keywords = el.content?.keywords?.join(', ') || 'none';
      console.log(`  ${index + 1}. ${selector} (${role}, ${reliability}, ${area}px², keywords: ${keywords})`);
    });
  }

  // Step 5: Use LLM to find best selector with actual content analysis
  console.log('🤖 Step 5: Using LLM to find best selector with actual content analysis...');
  const llmResult = await findBestSelectorWithEnhancedLLM(filteredElements, visualContext, elementDescription, semanticAnalysis, page);
  console.log(`✅ LLM generated selector: "${llmResult.selector}" (confidence: ${llmResult.confidence})`);
  
  // Get actual content for final selector to show what was selected
  const finalContent = await getSelectorContent(page, llmResult.selector);
  if (finalContent) {
    console.log(`📝 Final selector content preview: "${finalContent.visibleText.substring(0, 150)}..."`);
    console.log(`🏷️ Final selector semantic indicators: [${finalContent.semanticIndicators.join(', ')}]`);
  }

  console.log(`🏆 Final selector: "${llmResult.selector}"`);

  return llmResult;
};

// Enhanced HTML structure extraction - ENHANCED VERSION
const extractEnhancedHtmlStructure = async (page) => {
  const htmlStructure = await page.evaluate(() => {
    // Move all helper functions inside the browser context
    
    // Calculate semantic importance with better heuristics
    const calculateSemanticImportance = (element, tagName, classes, id, text, rect) => {
      let score = 0;
      
      // Semantic HTML elements
      const semanticScores = {
        'header': 15, 'nav': 14, 'main': 18, 'section': 12, 'article': 10,
        'aside': 8, 'footer': 10, 'form': 9, 'table': 11, 'figure': 7,
        'h1': 16, 'h2': 14, 'h3': 12, 'h4': 10, 'h5': 8, 'h6': 6
      };
      score += semanticScores[tagName] || 0;
      
      // ID-based scoring with semantic analysis
      if (id) {
        score += 8;
        const semanticIds = [
          'header', 'nav', 'navigation', 'main', 'content', 'footer', 'sidebar',
          'hero', 'banner', 'jumbotron', 'intro', 'pricing', 'plans', 'features',
          'about', 'contact', 'product', 'gallery', 'testimonials', 'blog'
        ];
        
        const idLower = String(id).toLowerCase();
        semanticIds.forEach(semantic => {
          if (idLower.includes(semantic)) {
            score += 6;
          }
        });
      }
      
      // Class-based scoring with semantic analysis
      if (classes) {
        score += 5;
        const classArray = String(classes).toLowerCase().split(' ');
        const semanticClasses = [
          'header', 'nav', 'navigation', 'navbar', 'menu', 'main', 'content',
          'section', 'hero', 'banner', 'jumbotron', 'intro', 'footer', 'sidebar',
          'pricing', 'plans', 'features', 'card', 'panel', 'container', 'wrapper',
          'testimonials', 'about', 'contact', 'product', 'gallery', 'blog'
        ];
        
        classArray.forEach(cls => {
          semanticClasses.forEach(semantic => {
            if (cls.includes(semantic)) {
              score += 4;
            }
          });
        });
      }
      
      // Size-based scoring (larger elements are often more important)
      const area = rect.width * rect.height;
      if (area > 10000) score += 5;
      if (area > 50000) score += 8;
      if (area > 100000) score += 12;
      
      // Position-based scoring (elements higher on page are often more important)
      if (rect.top < 600) score += 3;
      if (rect.top < 300) score += 5;
      
      // Text content scoring
      const textLength = text.length;
      if (textLength > 50) score += 2;
      if (textLength > 200) score += 4;
      if (textLength > 500) score += 6;
      
      // Children count (container elements)
      const childrenCount = element.children.length;
      if (childrenCount > 2) score += 2;
      if (childrenCount > 5) score += 4;
      if (childrenCount > 10) score += 6;
      
      return score;
    };

    // Clean CSS identifiers
    const cleanCSSIdentifier = (str) => {
      if (!str) return '';
      return String(str)
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .replace(/^[0-9]/, '_$&')
        .replace(/^-+/, '')
        .substring(0, 50);
    };

    // Generate multiple selector options with hierarchy for better targeting
    // This function creates selectors that include parent context to distinguish between similar elements
    // Example: If two divs have class "foo" but one is inside div with class "bar",
    // it will generate: ".bar > .foo" for the nested one, and ".foo" for the standalone one
    const generateMultipleSelectors = (element, tagName, classes, id) => {
      const selectors = [];
      
      // Helper function to get parent context
      const getParentContext = (el, depth = 2) => {
        const contexts = [];
        let current = el.parentElement;
        let currentDepth = 0;

        while (current && currentDepth < depth && current !== document.body) {
          const parentTag = current.tagName.toLowerCase();
          const parentId = current.id;
          const parentClasses = current.className;

          // Create parent selector
          let parentSelector = parentTag;
          if (parentId) {
            const cleanParentId = cleanCSSIdentifier(parentId);
            if (cleanParentId) {
              parentSelector = `#${cleanParentId}`;
            }
          } else if (parentClasses) {
            const parentClassList = String(parentClasses).split(' ')
              .map(cls => cleanCSSIdentifier(cls))
              .filter(cls => cls && cls.length > 0);
            if (parentClassList.length > 0) {
              parentSelector = `${parentTag}.${parentClassList[0]}`;
            }
          }

          contexts.push(parentSelector);
          current = current.parentElement;
          currentDepth++;
        }

        return contexts;
      };

      // Get parent contexts for hierarchical selectors
      const parentContexts = getParentContext(element);

      // ID-based selectors
      if (id) {
        const cleanId = cleanCSSIdentifier(id);
        if (cleanId) {
          selectors.push(`#${cleanId}`);
          selectors.push(`${tagName}#${cleanId}`);

          // Add hierarchical ID selectors
          parentContexts.forEach(parentCtx => {
            selectors.push(`${parentCtx} > #${cleanId}`);
            selectors.push(`${parentCtx} #${cleanId}`);
          });
        }
      }
      
      // Class-based selectors with hierarchy
      if (classes) {
        const classList = String(classes).split(' ')
          .map(cls => cleanCSSIdentifier(cls))
          .filter(cls => cls && cls.length > 0);
        
        if (classList.length > 0) {
          const primaryClass = classList[0];
          const tagWithClass = `${tagName}.${primaryClass}`;
          const classOnly = `.${primaryClass}`;

          // Basic class selectors
          selectors.push(tagWithClass);
          selectors.push(classOnly);

          // Hierarchical class selectors
          parentContexts.forEach(parentCtx => {
            selectors.push(`${parentCtx} > ${tagWithClass}`);
            selectors.push(`${parentCtx} > ${classOnly}`);
            selectors.push(`${parentCtx} ${tagWithClass}`);
            selectors.push(`${parentCtx} ${classOnly}`);
          });

          // Multi-class selectors
          if (classList.length > 1) {
            const multiClass = `${tagName}.${classList.slice(0, 2).join('.')}`;
            selectors.push(multiClass);

            // Hierarchical multi-class selectors
            parentContexts.forEach(parentCtx => {
              selectors.push(`${parentCtx} > ${multiClass}`);
              selectors.push(`${parentCtx} ${multiClass}`);
            });
          }

          if (classList.length > 2) {
            const tripleClass = `${tagName}.${classList.slice(0, 3).join('.')}`;
            selectors.push(tripleClass);

            // Hierarchical triple-class selectors
            if (parentContexts.length > 0) {
              selectors.push(`${parentContexts[0]} > ${tripleClass}`);
              selectors.push(`${parentContexts[0]} ${tripleClass}`);
            }
          }
        }
      }
      
      // Attribute-based selectors with hierarchy
      const attributes = Array.from(element.attributes);
      attributes.forEach(attr => {
        if (attr.name.startsWith('data-') && attr.value) {
          const cleanValue = cleanCSSIdentifier(attr.value);
          if (cleanValue) {
            const attrSelector = `${tagName}[${attr.name}="${cleanValue}"]`;
            selectors.push(attrSelector);

            // Hierarchical attribute selectors
            if (parentContexts.length > 0) {
              selectors.push(`${parentContexts[0]} > ${attrSelector}`);
              selectors.push(`${parentContexts[0]} ${attrSelector}`);
            }
          }
        }
      });
      
      // Structural selectors with hierarchy
      if (element.parentNode && element.parentNode.children) {
        const nthChild = Array.from(element.parentNode.children).indexOf(element) + 1;
        const nthChildSelector = `${tagName}:nth-child(${nthChild})`;
        selectors.push(nthChildSelector);
        
        // Calculate nth-of-type
        const siblings = Array.from(element.parentNode.children).filter(child => 
          child.tagName && child.tagName.toLowerCase() === tagName
        );
        const nthOfType = siblings.indexOf(element) + 1;
        const nthTypeSelector = `${tagName}:nth-of-type(${nthOfType})`;
        selectors.push(nthTypeSelector);

        // Hierarchical structural selectors
        if (parentContexts.length > 0) {
          selectors.push(`${parentContexts[0]} > ${nthChildSelector}`);
          selectors.push(`${parentContexts[0]} > ${nthTypeSelector}`);
        }
      }

      // Remove duplicates while preserving order (most specific first)
      const uniqueSelectors = [];
      const seen = new Set();

      selectors.forEach(selector => {
        if (!seen.has(selector)) {
          seen.add(selector);
          uniqueSelectors.push(selector);
        }
      });

      return uniqueSelectors;
    };

    // Enhanced element context with comprehensive information
    const getElementContext = (element) => {
      const context = {
        parent: element.parentNode?.tagName?.toLowerCase() || '',
        parentClasses: element.parentNode?.className || '',
        parentId: element.parentNode?.id || '',
        siblings: [],
        children: [],
        position: {
          indexInParent: 0,
          totalSiblings: 0,
          siblingTagCounts: {}
        },
        relationships: {
          nearestHeading: null,
          nearestLandmark: null,
          containingSection: null
        }
      };
      
      if (element.parentNode && element.parentNode.children) {
        const siblings = Array.from(element.parentNode.children);
        context.position.indexInParent = siblings.indexOf(element);
        context.position.totalSiblings = siblings.length;

        // Count sibling tags
        siblings.forEach(sibling => {
          if (sibling.tagName) {
            const tag = sibling.tagName.toLowerCase();
            context.position.siblingTagCounts[tag] = (context.position.siblingTagCounts[tag] || 0) + 1;
          }
        });

        context.siblings = siblings.map(child => ({
          tagName: child.tagName ? child.tagName.toLowerCase() : '',
          classes: child.className || '',
          id: child.id || '',
          text: child.textContent?.trim().substring(0, 50) || '',
          isSelf: child === element
        }));
      }
      
      if (element.children) {
        context.children = Array.from(element.children).map(child => ({
          tagName: child.tagName ? child.tagName.toLowerCase() : '',
          classes: child.className || '',
          id: child.id || '',
          text: child.textContent?.trim().substring(0, 50) || '',
          childrenCount: child.children.length
        }));
      }
      
      // Find nearest heading
      let current = element.previousElementSibling;
      while (current) {
        if (current.tagName && current.tagName.match(/^H[1-6]$/)) {
          context.relationships.nearestHeading = {
            level: parseInt(current.tagName.charAt(1)),
            text: current.textContent?.trim() || '',
            id: current.id || '',
            className: current.className || ''
          };
          break;
        }
        current = current.previousElementSibling;
      }

      // Find containing section/landmark
      current = element.parentElement;
      while (current && current !== document.body) {
        const tag = current.tagName.toLowerCase();
        if (['section', 'article', 'main', 'nav', 'header', 'footer', 'aside'].includes(tag)) {
          context.relationships.containingSection = {
            tagName: tag,
            id: current.id || '',
            className: current.className || '',
            role: current.getAttribute('role') || ''
          };
          break;
        }
        current = current.parentElement;
      }

      return context;
    };

    // Get element depth in DOM
    const getElementDepth = (element) => {
      let depth = 0;
      let current = element;
      while (current.parentNode && current.parentNode !== document) {
        depth++;
        current = current.parentNode;
      }
      return depth;
    };

    // Analyze element content for better categorization
    const analyzeElementContent = (element, text) => {
      const analysis = {
        contentType: 'generic',
        semanticRole: 'unknown',
        interactivity: 'static',
        visualImportance: 'normal',
        keywords: [],
        hasImages: false,
        hasLinks: false,
        hasForm: false,
        hasTable: false,
        textDensity: 'low',
        structuralComplexity: 'simple'
      };

      // Content type analysis
      if (text.length > 500) analysis.contentType = 'long-form';
      else if (text.length > 100) analysis.contentType = 'medium-form';
      else if (text.length > 20) analysis.contentType = 'short-form';
      else analysis.contentType = 'minimal';

      // Text density
      const wordsPerChar = (text.match(/\s+/g) || []).length / (text.length || 1);
      if (wordsPerChar > 0.15) analysis.textDensity = 'high';
      else if (wordsPerChar > 0.08) analysis.textDensity = 'medium';

      // Semantic role detection
      const tagName = element.tagName.toLowerCase();
      if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
        analysis.semanticRole = 'heading';
      } else if (tagName === 'nav' || element.getAttribute('role') === 'navigation') {
        analysis.semanticRole = 'navigation';
      } else if (tagName === 'main' || element.getAttribute('role') === 'main') {
        analysis.semanticRole = 'main-content';
      } else if (tagName === 'aside' || element.getAttribute('role') === 'complementary') {
        analysis.semanticRole = 'sidebar';
      } else if (tagName === 'footer' || element.getAttribute('role') === 'contentinfo') {
        analysis.semanticRole = 'footer';
      } else if (tagName === 'header' || element.getAttribute('role') === 'banner') {
        analysis.semanticRole = 'header';
      }

      // Interactivity analysis
      if (element.querySelector('button, input, select, textarea, [onclick], [href]')) {
        analysis.interactivity = 'interactive';
      } else if (element.querySelector('a')) {
        analysis.interactivity = 'navigational';
      }

      // Visual importance based on styling
      const computedStyle = window.getComputedStyle(element);
      if (computedStyle.fontSize && parseFloat(computedStyle.fontSize) > 20) {
        analysis.visualImportance = 'high';
      } else if (computedStyle.fontWeight === 'bold' || computedStyle.fontWeight === '700') {
        analysis.visualImportance = 'emphasized';
      }

      // Content features
      analysis.hasImages = element.querySelector('img, picture, svg') !== null;
      analysis.hasLinks = element.querySelector('a') !== null;
      analysis.hasForm = element.querySelector('form, input, button, select, textarea') !== null;
      analysis.hasTable = element.querySelector('table') !== null;

      // Structural complexity
      const childrenCount = element.children.length;
      if (childrenCount > 10) analysis.structuralComplexity = 'complex';
      else if (childrenCount > 3) analysis.structuralComplexity = 'moderate';

      // Extract keywords from text
      const words = text.toLowerCase().match(/\b\w+\b/g) || [];
      const wordFreq = {};
      words.forEach(word => {
        if (word.length > 3) {
          wordFreq[word] = (wordFreq[word] || 0) + 1;
        }
      });
      analysis.keywords = Object.keys(wordFreq)
        .sort((a, b) => wordFreq[b] - wordFreq[a])
        .slice(0, 5);

      return analysis;
    };

    // Get accessibility information
    const getAccessibilityInfo = (element) => {
      return {
        role: element.getAttribute('role') || '',
        ariaLabel: element.getAttribute('aria-label') || '',
        ariaDescribedBy: element.getAttribute('aria-describedby') || '',
        ariaLabelledBy: element.getAttribute('aria-labelledby') || '',
        tabIndex: element.getAttribute('tabindex') || '',
        hasAriaAttributes: Array.from(element.attributes)
          .some(attr => attr.name.startsWith('aria-')),
        isLandmark: ['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'search', 'form']
          .includes(element.getAttribute('role') || ''),
        isHeading: element.tagName.match(/^H[1-6]$/) !== null,
        isInteractive: ['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'menu', 'menuitem']
          .includes(element.getAttribute('role') || '') ||
          ['a', 'button', 'input', 'select', 'textarea'].includes(element.tagName.toLowerCase())
      };
    };

    // Get visual styling information
    const getVisualInfo = (element, rect) => {
      const style = window.getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor || '',
        color: style.color || '',
        fontSize: style.fontSize || '',
        fontWeight: style.fontWeight || '',
        border: style.border || '',
        padding: style.padding || '',
        margin: style.margin || '',
        display: style.display || '',
        position: style.position || '',
        zIndex: style.zIndex || '',
        opacity: style.opacity || '',
        visibility: style.visibility || '',
        aspectRatio: rect.width && rect.height ? (rect.width / rect.height).toFixed(2) : '0',
        isFixed: style.position === 'fixed',
        isSticky: style.position === 'sticky',
        isAbsolute: style.position === 'absolute',
        isHidden: style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0'
      };
    };

    // Main extraction logic
    const elements = [];
    const processedElements = new Set();
    
    // Get all elements and their computed styles
    const allElements = document.querySelectorAll('*');
    
    allElements.forEach((element, index) => {
      // Skip non-visible elements
      const computedStyle = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      
      if (computedStyle.display === 'none' || 
          computedStyle.visibility === 'hidden' ||
          rect.width === 0 || 
          rect.height === 0) {
        return;
      }
      
      const tagName = element.tagName ? element.tagName.toLowerCase() : '';
      const classes = element.className || '';
      const id = element.id || '';
      const text = element.textContent?.trim().substring(0, 300) || '';
      
      // Skip non-content elements
      if (['script', 'style', 'meta', 'head', 'br', 'hr', 'link'].includes(tagName)) {
        return;
      }
      
      // Calculate semantic importance
      const importance = calculateSemanticImportance(element, tagName, classes, id, text, rect);
      
      // Skip low-importance elements
      if (importance < 5) return;
      
      // Generate multiple selector options with hierarchical targeting
      const selectors = generateMultipleSelectors(element, tagName, classes, id);
      
      // Log hierarchical selectors for debugging
      if (selectors.length > 0) {
        const hierarchicalSelectors = selectors.filter(sel => sel.includes(' > ') || sel.includes(' '));
        if (hierarchicalSelectors.length > 0) {
          console.log(`🔗 Generated ${hierarchicalSelectors.length} hierarchical selectors for ${tagName}${classes ? '.' + String(classes).split(' ')[0] : ''}${id ? '#' + id : ''}:`);
          hierarchicalSelectors.slice(0, 3).forEach(sel => console.log(`  - ${sel}`));
        }
      }

      // Get comprehensive contextual information
      const contextInfo = getElementContext(element);
      const contentAnalysis = analyzeElementContent(element, text);
      const accessibilityInfo = getAccessibilityInfo(element);
      const visualInfo = getVisualInfo(element, rect);
      
      // Create comprehensive element data
      const elementData = {
      // Basic identification
        selectors,
        tagName,
        classes,
        id,
        text,
        importance,

        // Position and size
        position: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          area: rect.width * rect.height,
          aspectRatio: visualInfo.aspectRatio,
          viewportPercentage: {
            width: (rect.width / window.innerWidth * 100).toFixed(1),
            height: (rect.height / window.innerHeight * 100).toFixed(1)
          }
        },

        // Structural information
        structure: {
          depth: getElementDepth(element),
          childrenCount: element.children ? element.children.length : 0,
          hasText: text.length > 0,
          hasChildren: element.children && element.children.length > 0,
          isContainer: element.children && element.children.length > 2,
          isLeaf: element.children && element.children.length === 0
        },

        // Enhanced context
        context: contextInfo,

        // Content analysis
        content: contentAnalysis,

        // Accessibility
        accessibility: accessibilityInfo,

        // Visual styling
        visual: visualInfo,

        // Reliability scores
        reliability: {
          hasStableId: !!id,
          hasSemanticClasses: String(classes).split(' ').some(cls =>
            ['header', 'nav', 'main', 'content', 'section', 'footer', 'sidebar', 'hero', 'pricing'].includes(cls.toLowerCase())
          ),
          isSemanticElement: ['header', 'nav', 'main', 'section', 'article', 'aside', 'footer'].includes(tagName),
          hasUniqueTextContent: text.length > 20, // Simplified - just check if has substantial text
          selectorComplexity: selectors.length > 0 ? selectors[0].split(/[\s>+~]/).length : 10
        },

        // Searchability hints
        searchHints: {
          primaryKeywords: contentAnalysis.keywords,
          semanticContext: contextInfo.relationships.nearestHeading?.text || '',
          sectionContext: contextInfo.relationships.containingSection?.tagName || '',
          functionalRole: accessibilityInfo.role || contentAnalysis.semanticRole,
          visualPriority: visualInfo.zIndex || '0'
        }
      };

      elements.push(elementData);
    });
    
    return elements.sort((a, b) => b.importance - a.importance).slice(0, 40);
  });
  
  return htmlStructure;
};


class ReActScreenshotAgent {
  constructor() {
    this.currentPage = null;
    this.llm = new ChatOpenAI({
      modelName: 'gpt-4.1',
      temperature: 0.1,
      openAIApiKey: process.env.OPENAI_API_KEY,
    });
    
    this.tools = createScreenshotTools(this);
    
    this.agent = createReactAgent({ 
      llm: this.llm, 
      tools: this.tools,
      systemPrompt: `You are an intelligent screenshot agent with enhanced CSS selector accuracy and height optimization.

Your capabilities:
1. Navigate to websites with proper error handling
2. Analyze page content comprehensively including semantic structure
3. Find specific pages through intelligent navigation
4. Locate elements with high accuracy using multi-step semantic analysis
5. Debug selectors to understand why they might fail
6. Take precise screenshots of targeted elements
7. Automatically optimize element height for legible screenshots

ENHANCED WORKFLOW:
1. **Navigate**: Go to the target URL
2. **Analyze**: Understand page structure and content using analyze_current_page
3. **Navigate Further**: If needed, find and click relevant links
4. **Semantic Analysis**: For complex queries (like "nomenclature section"), use analyze_page_semantics to understand headings and sections
5. **Locate Precisely**: Use enhanced selector finding with semantic context
6. **Debug**: If selector fails, use debug_selector to understand why
7. **Validate**: Ensure the selector is accurate before taking screenshot
8. **Height Optimization**: Automatically find better child selectors if element is too tall
9. **Capture**: Take the final screenshot

IMPORTANT GUIDELINES:
- For section-based queries (e.g., "pricing section", "about section", "nomenclature section"), ALWAYS use analyze_page_semantics first
- The semantic analysis will show you all headings and their associated content - use this to find the right section
- Always validate selectors before taking screenshots
- If a selector fails or times out, use debug_selector to investigate
- If selector accuracy is low, try alternative approaches
- For complex elements, break down the description into parts
- Use semantic understanding to improve element targeting
- Report confidence levels for found selectors
- Pay attention to heading hierarchy (h1, h2, h3, etc.) and content relationships

HEIGHT OPTIMIZATION FEATURES:
- Elements taller than 1000px are automatically optimized by finding better child selectors
- Prefers elements with height between 150-600px for optimal screenshot legibility
- Avoids very tall sections that make poor, illegible screenshots
- Intelligently selects meaningful content within large containers
- Reports when height optimization has been applied

Your enhanced selector finding provides:
- Multiple hierarchical selector options tested for accuracy
- Parent-child relationship context (e.g., ".bar > .foo" vs ".foo")
- Confidence scores for reliability assessment
- Detailed reasoning for selector choices
- Fallback options if primary selector fails
- Automatic height optimization for better screenshot quality
- Child selector finding for oversized elements

HIERARCHICAL SELECTOR APPROACH:
The system now generates selectors that include parent context to distinguish between similar elements:
- Elements with same class but different parents get different selectors
- Example: ".bar > .foo" for foo inside bar, vs ".foo" for standalone foo
- This improves targeting accuracy and reduces ambiguity

Always prioritize accuracy and screenshot quality over speed.`
    });
  }

  async takeScreenshot(prompt) {
    try {
      console.log(`🚀 Starting takeScreenshot with prompt: "${prompt}"`);
      const messages = [{ role: "user", content: prompt }];
      
      console.log(`🤖 Starting agent stream...`);
      const stream = await this.agent.stream({ messages }, {
        streamMode: "values",
        recursionLimit: 50
      });

      let finalResult = null;
      let allMessages = [];
      let screenshotAttempts = [];
      
      console.log(`📥 Processing agent stream...`);
      for await (const { messages } of stream) {
        allMessages = messages;
      }
      console.log(`✅ Agent stream completed, processing ${allMessages.length} messages`);
      
      for (const message of allMessages) {
        if (message.content && typeof message.content === 'string') {
          try {
            const parsed = JSON.parse(message.content);
            if (parsed.success && parsed.screenshot) {
              console.log(`📸 Found screenshot attempt: ${parsed.screenshot.url}`);
              screenshotAttempts.push(parsed);
            }
          } catch (e) {
            // Not JSON, ignore
          }
        }
      }
      
      if (screenshotAttempts.length > 0) {
        console.log(`✅ Found ${screenshotAttempts.length} screenshot attempts, using the latest`);
        finalResult = screenshotAttempts[screenshotAttempts.length - 1];
      } else {
        console.log(`⚠️ No successful screenshot attempts found, trying fallback...`);
      }
      
      if (!finalResult && this.currentPage) {
        // Enhanced fallback screenshot with better selector detection
        const currentUrl = this.currentPage.url();
        const promptLower = prompt.toLowerCase();
        
        let fallbackSelector = 'body';
        
        // Smart fallback selector detection
        if (promptLower.includes('pricing') && currentUrl.includes('pricing')) {
          fallbackSelector = await this.findSmartFallbackSelector(this.currentPage, 'pricing');
        } else if (promptLower.includes('hero') || promptLower.includes('banner')) {
          fallbackSelector = await this.findSmartFallbackSelector(this.currentPage, 'hero');
        } else if (promptLower.includes('nav') || promptLower.includes('menu')) {
          fallbackSelector = await this.findSmartFallbackSelector(this.currentPage, 'navigation');
        } else if (promptLower.includes('footer')) {
          fallbackSelector = await this.findSmartFallbackSelector(this.currentPage, 'footer');
        } else if (promptLower.includes('content') || promptLower.includes('main')) {
          fallbackSelector = await this.findSmartFallbackSelector(this.currentPage, 'content');
        }
        
        try {
          const result = await captureImages({
            url: currentUrl,
            selector: fallbackSelector,
            width: 1280,
            height: 720,
            page: this.currentPage,
            fileExtension: 'png'
          });
          
          finalResult = {
            success: true,
            screenshot: result,
            message: `Captured screenshot using smart fallback selector: ${fallbackSelector}`
          };
        } catch (error) {
          console.error('Enhanced fallback screenshot failed:', error);
        }
      }
      
      if (finalResult && finalResult.success && finalResult.screenshot) {
        console.log(`🎉 Screenshot operation completed successfully!`);
        console.log(`📷 Screenshot URL: ${finalResult.screenshot.url}`);
        return {
          success: true,
          screenshot: finalResult.screenshot,
          metadata: {
            prompt,
            url: this.currentPage ? this.currentPage.url() : 'unknown',
            executionTime: Date.now() - Date.now()
          }
        };
      } else {
        console.log(`❌ Screenshot operation failed - no valid screenshot captured`);
        throw new Error('Agent completed but no screenshot was captured. The requested element might not be available on the website.');
      }
    } catch (error) {
      console.error(`💥 takeScreenshot failed:`, error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      console.log(`🧹 Cleaning up resources...`);
      if (this.currentPage) {
        try {
          await releasePage(this.currentPage);
          this.currentPage = null;
          console.log(`✅ Page released successfully`);
        } catch (error) {
          console.error('❌ Error releasing page:', error);
        }
      }
    }
  }

  // Streaming version of takeScreenshot for SSE
  async takeScreenshotStream(prompt, sseCallback) {
    const startTime = Date.now();

    try {
      console.log(`🚀 Starting streaming takeScreenshot with prompt: "${prompt}"`);

      // Emit initial event
      sseCallback({
        type: 'start',
        data: {
          prompt,
          timestamp: new Date().toISOString(),
          message: 'Starting screenshot agent...'
        }
      });

      const messages = [{ role: "user", content: prompt }];

      console.log(`🤖 Starting agent stream...`);
      sseCallback({
        type: 'progress',
        data: {
          step: 'initializing',
          message: 'Initializing AI agent...',
          timestamp: new Date().toISOString()
        }
      });

      const stream = await this.agent.stream({ messages }, {
        streamMode: "values",
        recursionLimit: 50
      });

      let finalResult = null;
      let allMessages = [];
      let screenshotAttempts = [];
      let stepCount = 0;

      console.log(`📥 Processing agent stream...`);
      sseCallback({
        type: 'progress',
        data: {
          step: 'processing',
          message: 'Agent is reasoning and planning...',
          timestamp: new Date().toISOString()
        }
      });

      for await (const { messages } of stream) {
        allMessages = messages;
        const lastMessage = messages[messages.length - 1];

        // Try to extract meaningful step information
        if (lastMessage?.content) {
          stepCount++;
          let stepMessage = 'Processing step...';
          let currentUrl = 'unknown';

          try {
            // Check if it's a tool call result
            if (typeof lastMessage.content === 'string') {
              const content = lastMessage.content;

              if (content.includes('navigate_to_url')) {
                stepMessage = 'Navigating to website...';
                const urlMatch = content.match(/https?:\/\/[^\s"]+/);
                if (urlMatch) {
                  currentUrl = urlMatch[0];
                  stepMessage = `Navigating to ${currentUrl}...`;
                }
              } else if (content.includes('analyze_current_page')) {
                stepMessage = 'Analyzing page structure...';
              } else if (content.includes('click_link')) {
                stepMessage = 'Clicking on link...';
              } else if (content.includes('find_element_selector')) {
                stepMessage = 'Finding target element...';
              } else if (content.includes('take_screenshot')) {
                stepMessage = 'Capturing screenshot...';
              } else if (content.includes('analyze_page_semantics')) {
                stepMessage = 'Analyzing page semantics...';
              } else if (content.includes('find_section_by_heading')) {
                stepMessage = 'Finding section by heading...';
              } else if (content.includes('debug_selector')) {
                stepMessage = 'Debugging selector...';
              }

              // Check for successful screenshot
              const parsed = JSON.parse(content);
              if (parsed.success && parsed.screenshot) {
                console.log(`📸 Found screenshot attempt: ${parsed.screenshot.url}`);
                screenshotAttempts.push(parsed);
                stepMessage = 'Screenshot captured successfully!';
              }
            }
          } catch (e) {
            // Not JSON or couldn't parse, use default message
          }

          // Update current URL if we have a page
          if (this.currentPage) {
            try {
              currentUrl = this.currentPage.url();
            } catch (e) {
              // Ignore errors getting URL
            }
          }

          sseCallback({
            type: 'progress',
            data: {
              step: `step_${stepCount}`,
              message: stepMessage,
              url: currentUrl,
              timestamp: new Date().toISOString(),
              totalSteps: stepCount
            }
          });
        }
      }

      console.log(`✅ Agent stream completed, processing ${allMessages.length} messages`);
      sseCallback({
        type: 'progress',
        data: {
          step: 'analyzing_results',
          message: 'Analyzing results...',
          timestamp: new Date().toISOString()
        }
      });

      // Process all messages to find screenshot attempts
      for (const message of allMessages) {
        if (message.content && typeof message.content === 'string') {
          try {
            const parsed = JSON.parse(message.content);
            if (parsed.success && parsed.screenshot) {
              console.log(`📸 Found screenshot attempt: ${parsed.screenshot.url}`);
              screenshotAttempts.push(parsed);
            }
          } catch (e) {
            // Not JSON, ignore
          }
        }
      }

      if (screenshotAttempts.length > 0) {
        console.log(`✅ Found ${screenshotAttempts.length} screenshot attempts, using the latest`);
        finalResult = screenshotAttempts[screenshotAttempts.length - 1];

        sseCallback({
          type: 'progress',
          data: {
            step: 'screenshot_found',
            message: 'Screenshot successfully captured!',
            timestamp: new Date().toISOString()
          }
        });
      } else {
        console.log(`⚠️ No successful screenshot attempts found, trying fallback...`);
        sseCallback({
          type: 'progress',
          data: {
            step: 'fallback',
            message: 'No screenshot found, trying fallback method...',
            timestamp: new Date().toISOString()
          }
        });
      }

      if (!finalResult && this.currentPage) {
        // Enhanced fallback screenshot with better selector detection
        const currentUrl = this.currentPage.url();
        const promptLower = prompt.toLowerCase();

        let fallbackSelector = 'body';

        // Smart fallback selector detection
        if (promptLower.includes('pricing') && currentUrl.includes('pricing')) {
          fallbackSelector = await this.findSmartFallbackSelector(this.currentPage, 'pricing');
        } else if (promptLower.includes('hero') || promptLower.includes('banner')) {
          fallbackSelector = await this.findSmartFallbackSelector(this.currentPage, 'hero');
        } else if (promptLower.includes('nav') || promptLower.includes('menu')) {
          fallbackSelector = await this.findSmartFallbackSelector(this.currentPage, 'navigation');
        } else if (promptLower.includes('footer')) {
          fallbackSelector = await this.findSmartFallbackSelector(this.currentPage, 'footer');
        } else if (promptLower.includes('content') || promptLower.includes('main')) {
          fallbackSelector = await this.findSmartFallbackSelector(this.currentPage, 'content');
        }

        try {
          sseCallback({
            type: 'progress',
            data: {
              step: 'fallback_capture',
              message: `Capturing fallback screenshot using selector: ${fallbackSelector}`,
              timestamp: new Date().toISOString()
            }
          });

          const result = await captureImages({
            url: currentUrl,
            selector: fallbackSelector,
            width: 1280,
            height: 720,
            page: this.currentPage,
            fileExtension: 'png'
          });

          finalResult = {
            success: true,
            screenshot: result,
            message: `Captured screenshot using smart fallback selector: ${fallbackSelector}`
          };
        } catch (error) {
          console.error('Enhanced fallback screenshot failed:', error);
          sseCallback({
            type: 'error',
            data: {
              step: 'fallback_failed',
              message: 'Fallback screenshot failed',
              error: error.message,
              timestamp: new Date().toISOString()
            }
          });
        }
      }

      if (finalResult && finalResult.success && finalResult.screenshot) {
        console.log(`🎉 Screenshot operation completed successfully!`);
        console.log(`📷 Screenshot URL: ${finalResult.screenshot.url}`);

        const endTime = Date.now();
        const executionTime = endTime - startTime;

        const result = {
          success: true,
          screenshot: finalResult.screenshot,
          metadata: {
            prompt,
            url: this.currentPage ? this.currentPage.url() : 'unknown',
            executionTime
          }
        };

        sseCallback({
          type: 'complete',
          data: {
            step: 'completed',
            message: 'Screenshot completed successfully!',
            result,
            timestamp: new Date().toISOString(),
            executionTime
          }
        });

        return result;
      } else {
        console.log(`❌ Screenshot operation failed - no valid screenshot captured`);
        const error = new Error('Agent completed but no screenshot was captured. The requested element might not be available on the website.');

        sseCallback({
          type: 'error',
          data: {
            step: 'failed',
            message: 'Screenshot operation failed',
            error: error.message,
            timestamp: new Date().toISOString()
          }
        });

        throw error;
      }
    } catch (error) {
      console.error(`💥 takeScreenshotStream failed:`, error);

      sseCallback({
        type: 'error',
        data: {
          step: 'error',
          message: 'Screenshot operation failed',
          error: error.message,
          timestamp: new Date().toISOString()
        }
      });

      return {
        success: false,
        error: error.message
      };
    } finally {
      console.log(`🧹 Cleaning up resources...`);
      if (this.currentPage) {
        try {
          await releasePage(this.currentPage);
          this.currentPage = null;
          console.log(`✅ Page released successfully`);
        } catch (error) {
          console.error('❌ Error releasing page:', error);
        }
      }

      // Send final event
      sseCallback({
        type: 'end',
        data: {
          step: 'cleanup',
          message: 'Cleaning up resources...',
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  // Smart fallback selector finder
  async findSmartFallbackSelector(page, type) {
    const fallbackSelectors = {
      pricing: [
        '.pricing-table, .pricing-plans, .pricing-section, .plans-section',
        '[class*="pricing"], [class*="plans"], [class*="price"]',
        'section:has([class*="pricing"]), section:has([class*="plans"])',
        'main section:nth-child(2), main section:nth-child(3)',
        'main, .main-content, #main-content'
      ],
      hero: [
        '.hero, .hero-section, .jumbotron, .banner, .intro-section',
        '[class*="hero"], [class*="banner"], [class*="jumbotron"]',
        'main section:first-child, .main-content > section:first-child',
        'header + section, header + div, nav + section',
        'main, .main-content'
      ],
      navigation: [
        'nav, .navbar, .navigation, .menu, .nav-menu',
        '[class*="nav"], [class*="menu"]',
        'header nav, header .nav, header .menu',
        'header, .header, #header'
      ],
      footer: [
        'footer, .footer, .site-footer, .page-footer',
        '[class*="footer"]',
        'body > footer, body > .footer',
        'body > *:last-child'
      ],
      content: [
        'main, .main-content, .content, .page-content',
        '[class*="content"], [class*="main"]',
        'body > main, body > .main, body > .content',
        'header + *, nav + *'
      ]
    };

    const selectors = fallbackSelectors[type] || ['main', 'body > div:first-child'];
    
    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          // Verify element is visible and has reasonable size
          const isVisible = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            
            return style.display !== 'none' && 
                   style.visibility !== 'hidden' &&
                   rect.width > 50 && 
                   rect.height > 50;
          }, selector);
          
          if (isVisible) {
            return selector;
          }
        }
      } catch (error) {
        continue;
      }
    }
    
    return 'body'; // Ultimate fallback
  }

  // Analyze page semantics to understand sections and content
  async analyzePageSemantics() {
    try {
      if (!this.currentPage) {
        return { error: 'No page is currently loaded' };
      }

      const semanticData = await this.currentPage.evaluate(() => {
        const result = {
          headings: [],
          sections: [],
          contentBlocks: [],
          landmarks: []
        };

        // Extract all headings with their hierarchy and content
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
        headings.forEach((heading, index) => {
          const level = parseInt(heading.tagName.charAt(1));
          const text = heading.textContent?.trim() || '';
          const id = heading.id || '';
          
          // Find content associated with this heading
          const associatedContent = [];
          let nextElement = heading.nextElementSibling;
          
          while (nextElement) {
            const nextTagName = nextElement.tagName.toLowerCase();
            
            // Stop if we hit another heading of same or higher level
            if (nextTagName.match(/^h[1-6]$/)) {
              const nextLevel = parseInt(nextTagName.charAt(1));
              if (nextLevel <= level) break;
            }
            
            // Collect content elements
            if (nextTagName === 'p' || nextTagName === 'div' || nextTagName === 'section' || 
                nextTagName === 'ul' || nextTagName === 'ol' || nextTagName === 'table') {
              const rect = nextElement.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                associatedContent.push({
                  tagName: nextTagName,
                  text: nextElement.textContent?.trim().substring(0, 200) || '',
                  className: nextElement.className || '',
                  id: nextElement.id || '',
                  selector: nextElement.id ? `#${nextElement.id}` : 
                           (nextElement.className ? `${nextTagName}.${nextElement.className.split(' ')[0]}` : nextTagName)
                });
              }
            }
            
            nextElement = nextElement.nextElementSibling;
          }

          result.headings.push({
            level,
            text,
            id,
            className: heading.className || '',
            index,
            associatedContent,
            selector: id ? `#${id}` : `h${level}:nth-of-type(${index + 1})`,
            keywords: text.toLowerCase().split(' ').filter(word => word.length > 2)
          });
        });

        // Extract semantic sections
        const semanticSections = Array.from(document.querySelectorAll('section, article, main, aside, nav, header, footer'));
        semanticSections.forEach(section => {
          const rect = section.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const headingsInSection = Array.from(section.querySelectorAll('h1, h2, h3, h4, h5, h6'))
              .map(h => h.textContent?.trim() || '');
            
            result.sections.push({
              tagName: section.tagName.toLowerCase(),
              className: section.className || '',
              id: section.id || '',
              headings: headingsInSection,
              textContent: section.textContent?.trim().substring(0, 300) || '',
              selector: section.id ? `#${section.id}` : 
                       (section.className ? `${section.tagName.toLowerCase()}.${section.className.split(' ')[0]}` : section.tagName.toLowerCase()),
              keywords: headingsInSection.join(' ').toLowerCase().split(' ').filter(word => word.length > 2)
            });
          }
        });

        // Extract content blocks (divs with substantial content)
        const contentBlocks = Array.from(document.querySelectorAll('div'))
          .filter(div => {
            const rect = div.getBoundingClientRect();
            const text = div.textContent?.trim() || '';
            return rect.width > 100 && rect.height > 50 && text.length > 50;
          })
          .slice(0, 20) // Limit to prevent overwhelming data
          .map(div => {
            const headings = Array.from(div.querySelectorAll('h1, h2, h3, h4, h5, h6'))
              .map(h => h.textContent?.trim() || '');
            
            return {
              className: div.className || '',
              id: div.id || '',
              headings,
              textContent: div.textContent?.trim().substring(0, 200) || '',
              selector: div.id ? `#${div.id}` : 
                       (div.className ? `div.${div.className.split(' ')[0]}` : 'div'),
              keywords: (headings.join(' ') + ' ' + div.textContent?.trim().substring(0, 200) || '')
                .toLowerCase().split(' ').filter(word => word.length > 2)
            };
          });

        result.contentBlocks = contentBlocks;

        // Extract landmarks and important elements
        const landmarks = Array.from(document.querySelectorAll('[role], [aria-label], [data-*]'))
          .filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .slice(0, 10)
          .map(el => ({
            tagName: el.tagName.toLowerCase(),
            role: el.getAttribute('role') || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            id: el.id || '',
            className: el.className || '',
            textContent: el.textContent?.trim().substring(0, 100) || '',
            selector: el.id ? `#${el.id}` : 
                     (el.className ? `${el.tagName.toLowerCase()}.${el.className.split(' ')[0]}` : el.tagName.toLowerCase())
          }));

        result.landmarks = landmarks;

        return result;
      });

      return semanticData;
    } catch (error) {
      return { error: error.message };
    }
  }

  // Find section by heading text
  async findSectionByHeading(headingText) {
    try {
      if (!this.currentPage) {
        return { error: 'No page is currently loaded' };
      }

      const sectionInfo = await this.currentPage.evaluate((searchText) => {
        const result = {
          searchText,
          matchingHeadings: [],
          recommendedSelectors: []
        };

        // Find all headings that match the search text
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
        
        headings.forEach((heading, index) => {
          const headingText = heading.textContent?.trim() || '';
          const headingLower = headingText.toLowerCase();
          const searchLower = searchText.toLowerCase();
          
          // Check for exact match or partial match
          let matchScore = 0;
          if (headingLower.includes(searchLower)) {
            matchScore = searchLower.length / headingLower.length;
          } else {
            // Check for word-based matches
            const headingWords = headingLower.split(' ');
            const searchWords = searchLower.split(' ');
            const matchingWords = searchWords.filter(word => 
              headingWords.some(hWord => hWord.includes(word) || word.includes(hWord))
            );
            matchScore = matchingWords.length / searchWords.length;
          }
          
          if (matchScore > 0.3) { // 30% match threshold
            const level = parseInt(heading.tagName.charAt(1));
            
            // Find content associated with this heading
            const associatedContent = [];
            const contentSelectors = [];
            let nextElement = heading.nextElementSibling;
            
            while (nextElement) {
              const nextTagName = nextElement.tagName.toLowerCase();
              
              // Stop if we hit another heading of same or higher level
              if (nextTagName.match(/^h[1-6]$/)) {
                const nextLevel = parseInt(nextTagName.charAt(1));
                if (nextLevel <= level) break;
              }
              
              // Collect content elements
              if (nextTagName === 'p' || nextTagName === 'div' || nextTagName === 'section' || 
                  nextTagName === 'ul' || nextTagName === 'ol' || nextTagName === 'table') {
                const rect = nextElement.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  const elementId = nextElement.id;
                  const elementClass = nextElement.className;
                  
                  let selector = nextTagName;
                  if (elementId) {
                    selector = `#${elementId}`;
                  } else if (elementClass) {
                    selector = `${nextTagName}.${elementClass.split(' ')[0]}`;
                  }
                  
                  associatedContent.push({
                    tagName: nextTagName,
                    text: nextElement.textContent?.trim().substring(0, 200) || '',
                    selector,
                    visible: true
                  });
                  
                  contentSelectors.push(selector);
                }
              }
              
              nextElement = nextElement.nextElementSibling;
            }
            
            // Create heading-specific selectors
            const headingId = heading.id;
            const headingClass = heading.className;
            let headingSelector = `h${level}`;
            
            if (headingId) {
              headingSelector = `#${headingId}`;
            } else if (headingClass) {
              headingSelector = `h${level}.${headingClass.split(' ')[0]}`;
            } else {
              // Use nth-of-type for headings without ID or class
              const sameTypeHeadings = Array.from(document.querySelectorAll(`h${level}`));
              const headingIndex = sameTypeHeadings.indexOf(heading) + 1;
              headingSelector = `h${level}:nth-of-type(${headingIndex})`;
            }
            
            result.matchingHeadings.push({
              text: headingText,
              level,
              selector: headingSelector,
              matchScore,
              associatedContent,
              contentSelectors
            });
            
            // Add recommended selectors for this section
            if (contentSelectors.length > 0) {
              result.recommendedSelectors.push({
                description: `Content under heading "${headingText}"`,
                selector: contentSelectors[0], // First content element
                alternativeSelectors: contentSelectors.slice(1, 3),
                headingSelector,
                confidence: matchScore
              });
            }
          }
        });
        
        // Sort by match score
        result.matchingHeadings.sort((a, b) => b.matchScore - a.matchScore);
        result.recommendedSelectors.sort((a, b) => b.confidence - a.confidence);
        
        return result;
      }, headingText);

      return sectionInfo;
    } catch (error) {
      return { error: error.message };
    }
  }

  // Debug selector method
  async debugSelector(selector) {
    try {
      if (!this.currentPage) {
        return { error: 'No page is currently loaded' };
      }

      const debugInfo = await this.currentPage.evaluate((sel) => {
        const result = {
          selector: sel,
          exists: false,
          visible: false,
          count: 0,
          elements: [],
          similarElements: []
        };

        // Check if elements exist
        const elements = document.querySelectorAll(sel);
        result.count = elements.length;
        result.exists = result.count > 0;

        if (result.exists) {
          // Get info about found elements
          result.elements = Array.from(elements).map((el, index) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            
            return {
              index,
              tagName: el.tagName.toLowerCase(),
              id: el.id || '',
              className: el.className || '',
              text: el.textContent?.trim().substring(0, 100) || '',
              visible: style.display !== 'none' && 
                      style.visibility !== 'hidden' &&
                      rect.width > 0 && rect.height > 0,
              position: {
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height
              }
            };
          });

          result.visible = result.elements.some(el => el.visible);
        } else {
          // If not found, look for similar elements
          const parts = sel.split(' ');
          const lastPart = parts[parts.length - 1];
          
          // Try to find elements that match parts of the selector
          const idMatch = lastPart.match(/#([a-zA-Z0-9_-]+)/);
          const classMatch = lastPart.match(/\.([a-zA-Z0-9_-]+)/);
          const tagMatch = lastPart.match(/^([a-zA-Z0-9]+)/);
          
          if (idMatch) {
            const id = idMatch[1];
            const byId = document.getElementById(id);
            if (byId) {
              result.similarElements.push({
                type: 'id',
                selector: `#${id}`,
                element: {
                  tagName: byId.tagName.toLowerCase(),
                  id: byId.id,
                  className: byId.className,
                  text: byId.textContent?.trim().substring(0, 100)
                }
              });
            }
          }
          
          if (classMatch) {
            const className = classMatch[1];
            const byClass = document.getElementsByClassName(className);
            if (byClass.length > 0) {
              result.similarElements.push({
                type: 'class',
                selector: `.${className}`,
                count: byClass.length,
                elements: Array.from(byClass).slice(0, 3).map(el => ({
                  tagName: el.tagName.toLowerCase(),
                  id: el.id,
                  className: el.className,
                  text: el.textContent?.trim().substring(0, 100)
                }))
              });
            }
          }
          
          if (tagMatch) {
            const tagName = tagMatch[1];
            const byTag = document.getElementsByTagName(tagName);
            if (byTag.length > 0) {
              result.similarElements.push({
                type: 'tag',
                selector: tagName,
                count: byTag.length,
                elements: Array.from(byTag).slice(0, 3).map(el => ({
                  tagName: el.tagName.toLowerCase(),
                  id: el.id,
                  className: el.className,
                  text: el.textContent?.trim().substring(0, 100)
                }))
              });
            }
          }
        }

        return result;
      }, selector);

      return debugInfo;
    } catch (error) {
      return { error: error.message };
    }
  }
}

// Additional utility functions for better selector accuracy

// Analyze element relationships for better context
const analyzeElementRelationships = async (page, selector) => {
  return await page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) return null;
    
    // Get parent hierarchy
    const parentHierarchy = [];
    let current = element.parentElement;
    while (current && current !== document.body) {
      parentHierarchy.push({
        tagName: current.tagName.toLowerCase(),
        className: current.className || '',
        id: current.id || ''
      });
      current = current.parentElement;
    }
    
    // Get sibling elements
    const siblings = Array.from(element.parentElement?.children || [])
      .filter(child => child !== element)
      .map(child => ({
        tagName: child.tagName.toLowerCase(),
        className: child.className || '',
        id: child.id || ''
      }));
    
    // Get child elements
    const children = Array.from(element.children).map(child => ({
      tagName: child.tagName.toLowerCase(),
      className: child.className || '',
      id: child.id || ''
    }));
    
    return {
      parentHierarchy,
      siblings,
      children,
      position: {
        index: Array.from(element.parentElement?.children || []).indexOf(element),
        total: element.parentElement?.children?.length || 0
      }
    };
  }, selector);
};

// Validate selector uniqueness and stability
const validateSelectorStability = async (page, selector) => {
  try {
    const elements = await page.$(selector);
    const elementCount = elements.length;
    
    if (elementCount === 0) {
      return { valid: false, reason: 'No elements found' };
    }
    
    if (elementCount > 1) {
      // Check if multiple elements are actually the same type of element
      const elementTypes = await page.evaluate((sel) => {
        const els = document.querySelectorAll(sel);
        return Array.from(els).map(el => {
          const rect = el.getBoundingClientRect();
          return {
            tagName: el.tagName.toLowerCase(),
            area: rect.width * rect.height,
            text: el.textContent?.trim().substring(0, 50),
            visible: rect.width > 0 && rect.height > 0
          };
        });
      }, selector);
      
      const visibleElements = elementTypes.filter(el => el.visible);
      if (visibleElements.length > 1) {
        return { 
          valid: false, 
          reason: `Multiple visible elements found (${visibleElements.length})`,
          elements: visibleElements 
        };
      }
    }
    
    // Check element stability (size, position)
    const elementInfo = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      
      return {
        hasStableSize: rect.width > 20 && rect.height > 20,
        hasContent: el.textContent?.trim().length > 0 || el.children.length > 0,
        isVisible: style.display !== 'none' && style.visibility !== 'hidden',
        position: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
      };
    }, selector);
    
    if (!elementInfo) {
      return { valid: false, reason: 'Could not analyze element' };
    }
    
    if (!elementInfo.hasStableSize) {
      return { valid: false, reason: 'Element too small or has no size' };
    }
    
    if (!elementInfo.isVisible) {
      return { valid: false, reason: 'Element not visible' };
    }
    
    return { 
      valid: true, 
      confidence: elementCount === 1 ? 0.9 : 0.7,
      elementInfo 
    };
    
  } catch (error) {
    return { valid: false, reason: `Validation error: ${error.message}` };
  }
};

// Export enhanced agent
const screenshotAgent = new ReActScreenshotAgent();

module.exports = {
  takeScreenshot: (prompt) => screenshotAgent.takeScreenshot(prompt),
  takeScreenshotStream: (prompt, sseCallback) => screenshotAgent.takeScreenshotStream(prompt, sseCallback),
  ReActScreenshotAgent,
  
  // Export utility functions for testing
  extractEnhancedHtmlStructure,
  findBestSelectorMultiStep,
  validateSelectorStability,
  analyzeElementRelationships
};