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

// Enhanced LLM-based selector finding with semantic analysis
const findBestSelectorWithEnhancedLLM = async (filteredElements, visualContext, elementDescription, semanticAnalysis) => {
  const llm = new ChatOpenAI({
    modelName: 'gpt-4.1',
    temperature: 0.1,
    openAIApiKey: process.env.OPENAI_API_KEY,
  }).withStructuredOutput(SelectorResponseSchema);

  // Extract relevant headings and sections for context
  const relevantHeadings = semanticAnalysis.headings?.filter(h => 
    calculateTextMatch(h.text, elementDescription) > 0.2
  ) || [];
  
  const relevantSections = semanticAnalysis.sections?.filter(s => 
    calculateTextMatch(s.headings.join(' '), elementDescription) > 0.2 ||
    calculateTextMatch(s.textContent, elementDescription) > 0.2
  ) || [];

  const systemPrompt = `You are an expert CSS selector analyst for web automation with deep understanding of page semantics. Your task is to find the most accurate and reliable CSS selector for the requested element.

ANALYSIS CONTEXT:
- Element Description: "${elementDescription}"
- Viewport: ${visualContext.viewport.width}x${visualContext.viewport.height}
- Available Elements: ${filteredElements.length} relevant elements found

SEMANTIC CONTEXT:
Page Headings (that may be relevant):
${JSON.stringify(relevantHeadings, null, 2)}

Page Sections (that may be relevant):
${JSON.stringify(relevantSections, null, 2)}

FILTERED ELEMENTS (most relevant first):
${JSON.stringify(filteredElements.slice(0, 10), null, 2)}

SEMANTIC UNDERSTANDING:
- If looking for a "section" (e.g., "nomenclature section"), look for headings with that text and their associated content
- For content under headings, consider elements that follow the heading in the DOM structure
- Pay attention to heading hierarchy (h1, h2, h3, etc.) and their relationships
- Consider that sections often contain multiple paragraphs, lists, or other content elements
- Look for elements that are semantically related to the query, not just textually similar

SELECTION CRITERIA:
1. **Semantic Match**: Does the element semantically match the description in the context of the page?
2. **Heading Context**: If targeting a section, is it properly associated with the relevant heading?
3. **Content Relevance**: Does the content actually relate to what the user is looking for?
4. **Specificity**: Choose specific selectors that won't match unintended elements
5. **Reliability**: Prefer selectors that are less likely to break with minor DOM changes
6. **Visibility**: Ensure the element is visible and has substantial size

SELECTOR PREFERENCES (in order):
1. Content associated with matching headings: elements that follow relevant h1-h6 tags
2. Semantic elements with meaningful IDs: section#nomenclature, div#content-area
3. Semantic elements with descriptive classes: section.content, div.section-content
4. Structural selectors targeting content after headings: h2:contains("text") + div, h3 + p
5. Attribute selectors: [data-section="nomenclature"]

RETURN FORMAT:
- selector: The best CSS selector
- confidence: 0.0-1.0 (how confident you are this is correct)
- reasoning: Why you chose this selector, including semantic context
- alternatives: 2-3 alternative selectors as backup

CRITICAL RULES:
- Only use standard CSS selectors that are widely supported
- NEVER use these unsupported pseudo-classes: :has(), :is(), :where()
- Avoid :not() with complex selectors - use simple :not() only
- NEVER use :contains() as it's not standard CSS (use semantic context instead)
- Test multiple options mentally before choosing
- Consider element size and position
- Avoid overly specific selectors that might break easily
- Prefer semantic HTML elements when available
- If you need to target elements after a specific heading, use nth-child() or adjacent selectors (+)
- Consider the semantic relationship between headings and their content`;

  const response = await llm.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(`Find the best CSS selector for: "${elementDescription}"
    
Context: I need to find and screenshot the element that represents "${elementDescription}" on this page. Look at the semantic context provided above to understand what headings and sections are available, and find the most appropriate content area that matches my request.`)
  ]);

  return response;
};

// Validate and test selectors
const validateAndTestSelectors = async (page, llmResult) => {
  const selectorsToTest = [llmResult.selector, ...(llmResult.alternatives || [])];
  const testResults = [];
  
  for (const selector of selectorsToTest) {
    try {
      // Check for unsupported pseudo-classes first
      if (selector.includes(':has(') || selector.includes(':is(') || selector.includes(':where(')) {
        console.warn(`Skipping selector with unsupported pseudo-class: ${selector}`);
        continue;
      }
      
      const elements = await page.$$(selector);
      const elementCount = elements.length;
      
      if (elementCount > 0) {
        // Get element info for validation
        const elementInfo = await page.evaluate((sel) => {
          const element = document.querySelector(sel);
          if (!element) return null;
          
          const rect = element.getBoundingClientRect();
          const computedStyle = window.getComputedStyle(element);
          
          return {
            tagName: element.tagName.toLowerCase(),
            className: element.className,
            id: element.id,
            text: element.textContent?.trim().substring(0, 200),
            isVisible: computedStyle.display !== 'none' && 
                      computedStyle.visibility !== 'hidden' &&
                      rect.width > 0 && rect.height > 0,
            position: {
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height
            },
            area: rect.width * rect.height
          };
        }, selector);
        
        if (elementInfo && elementInfo.isVisible) {
          testResults.push({
            selector,
            elementCount,
            elementInfo,
            score: calculateSelectorScore(elementInfo, elementCount, llmResult.confidence)
          });
        }
      }
    } catch (error) {
      console.warn(`Selector validation failed for ${selector}:`, error.message);
    }
  }
  
  // Sort by score and return best result
  testResults.sort((a, b) => b.score - a.score);
  
  const bestResult = testResults[0];
  
  if (bestResult) {
    return {
      selector: bestResult.selector,
      confidence: Math.min(llmResult.confidence * 1.1, 1.0), // Boost confidence if validated
      reasoning: `${llmResult.reasoning} [Validated: Found ${bestResult.elementCount} element(s), visible: ${bestResult.elementInfo.isVisible}]`,
      alternatives: testResults.slice(1, 3).map(r => r.selector),
      elementInfo: bestResult.elementInfo,
      validated: true
    };
  } else {
    // Fallback to original if no selectors worked
    return {
      selector: llmResult.selector,
      confidence: Math.max(llmResult.confidence * 0.5, 0.1),
      reasoning: `${llmResult.reasoning} [Warning: Could not validate selector]`,
      alternatives: llmResult.alternatives || [],
      validated: false
    };
  }
};

// Calculate selector score for ranking
const calculateSelectorScore = (elementInfo, elementCount, confidence) => {
  let score = confidence * 100;
  
  // Prefer single matches
  if (elementCount === 1) {
    score += 20;
  } else if (elementCount <= 3) {
    score += 10;
  } else {
    score -= 10;
  }
  
  // Prefer larger elements (more likely to be the target)
  const area = elementInfo.area;
  if (area > 10000) score += 10;
  if (area > 50000) score += 15;
  if (area > 100000) score += 20;
  
  // Prefer elements with meaningful text
  if (elementInfo.text && elementInfo.text.length > 20) {
    score += 10;
  }
  
  return score;
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
  console.log(`✅ Found ${htmlStructure.length} elements in HTML structure`);
  
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
  
  // Step 5: Use LLM to find best selector with enhanced context
  console.log('🤖 Step 5: Using LLM to find best selector...');
  const llmResult = await findBestSelectorWithEnhancedLLM(filteredElements, visualContext, elementDescription, semanticAnalysis);
  console.log(`✅ LLM generated selector: "${llmResult.selector}" (confidence: ${llmResult.confidence})`);
  
  // Step 6: Validate and test selectors
  console.log('✔️ Step 6: Validating and testing selectors...');
  const validatedResult = await validateAndTestSelectors(page, llmResult);
  console.log(`✅ Validation complete: ${validatedResult.validated ? 'PASSED' : 'FAILED'} (final confidence: ${validatedResult.confidence})`);
  console.log(`🏆 Final selector: "${validatedResult.selector}"`);
  
  return validatedResult;
};

// Enhanced HTML structure extraction - FIXED VERSION
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

    // Generate multiple selector options for robustness
    const generateMultipleSelectors = (element, tagName, classes, id) => {
      const selectors = [];
      
      // ID-based selectors
      if (id) {
        const cleanId = cleanCSSIdentifier(id);
        if (cleanId) {
          selectors.push(`#${cleanId}`);
          selectors.push(`${tagName}#${cleanId}`);
        }
      }
      
      // Class-based selectors
      if (classes) {
        const classList = String(classes).split(' ')
          .map(cls => cleanCSSIdentifier(cls))
          .filter(cls => cls && cls.length > 0);
        
        if (classList.length > 0) {
          selectors.push(`${tagName}.${classList[0]}`);
          if (classList.length > 1) {
            selectors.push(`${tagName}.${classList.slice(0, 2).join('.')}`);
            selectors.push(`.${classList[0]}`);
          }
          if (classList.length > 2) {
            selectors.push(`${tagName}.${classList.slice(0, 3).join('.')}`);
          }
        }
      }
      
      // Attribute-based selectors
      const attributes = Array.from(element.attributes);
      attributes.forEach(attr => {
        if (attr.name.startsWith('data-') && attr.value) {
          const cleanValue = cleanCSSIdentifier(attr.value);
          if (cleanValue) {
            selectors.push(`${tagName}[${attr.name}="${cleanValue}"]`);
          }
        }
      });
      
      // Structural selectors
      if (element.parentNode && element.parentNode.children) {
        const nthChild = Array.from(element.parentNode.children).indexOf(element) + 1;
        selectors.push(`${tagName}:nth-child(${nthChild})`);
        
        // Calculate nth-of-type
        const siblings = Array.from(element.parentNode.children).filter(child => 
          child.tagName && child.tagName.toLowerCase() === tagName
        );
        const nthOfType = siblings.indexOf(element) + 1;
        selectors.push(`${tagName}:nth-of-type(${nthOfType})`);
      }
      
      return selectors;
    };

    // Get element context for better understanding
    const getElementContext = (element) => {
      const context = {
        parent: element.parentNode?.tagName?.toLowerCase() || '',
        parentClasses: element.parentNode?.className || '',
        parentId: element.parentNode?.id || '',
        siblings: [],
        children: []
      };
      
      if (element.parentNode && element.parentNode.children) {
        context.siblings = Array.from(element.parentNode.children).map(child => ({
          tagName: child.tagName ? child.tagName.toLowerCase() : '',
          classes: child.className || '',
          id: child.id || ''
        }));
      }
      
      if (element.children) {
        context.children = Array.from(element.children).map(child => ({
          tagName: child.tagName ? child.tagName.toLowerCase() : '',
          classes: child.className || '',
          id: child.id || ''
        }));
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
      
      // Generate multiple selector options
      const selectors = generateMultipleSelectors(element, tagName, classes, id);
      
      // Get contextual information
      const contextInfo = getElementContext(element);
      
      elements.push({
        selectors,
        tagName,
        classes,
        id,
        text,
        importance,
        position: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height
        },
        context: contextInfo,
        childrenCount: element.children ? element.children.length : 0,
        depth: getElementDepth(element)
      });
    });
    
    return elements.sort((a, b) => b.importance - a.importance).slice(0, 50);
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
      systemPrompt: `You are an intelligent screenshot agent with enhanced CSS selector accuracy.

Your capabilities:
1. Navigate to websites with proper error handling
2. Analyze page content comprehensively including semantic structure
3. Find specific pages through intelligent navigation
4. Locate elements with high accuracy using multi-step semantic analysis
5. Debug selectors to understand why they might fail
6. Take precise screenshots of targeted elements

ENHANCED WORKFLOW:
1. **Navigate**: Go to the target URL
2. **Analyze**: Understand page structure and content using analyze_current_page
3. **Navigate Further**: If needed, find and click relevant links
4. **Semantic Analysis**: For complex queries (like "nomenclature section"), use analyze_page_semantics to understand headings and sections
5. **Locate Precisely**: Use enhanced selector finding with semantic context
6. **Debug**: If selector fails, use debug_selector to understand why
7. **Validate**: Ensure the selector is accurate before taking screenshot
8. **Capture**: Take the final screenshot

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

Your enhanced selector finding provides:
- Multiple selector options tested for accuracy
- Confidence scores for reliability assessment
- Detailed reasoning for selector choices
- Fallback options if primary selector fails

Always prioritize accuracy over speed.`
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
  ReActScreenshotAgent,
  
  // Export utility functions for testing
  extractEnhancedHtmlStructure,
  findBestSelectorMultiStep,
  validateSelectorStability,
  analyzeElementRelationships
};