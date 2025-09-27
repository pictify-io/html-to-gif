async function getRenderedHTML(url, page) {


  try {
    console.log('Creating new page');

    console.log('Setting viewport');
    await page.setViewport({ width: 1280, height: 720 });

    console.log('Setting Content Security Policy');
    // Set a more permissive Content Security Policy
    await page.setExtraHTTPHeaders({
      'Content-Security-Policy': "default-src * 'unsafe-inline' 'unsafe-eval'; img-src * data: blob:; script-src * 'unsafe-inline' 'unsafe-eval';"
    });

    console.log('Navigating to page');
    // Navigate to the page with a longer timeout
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 10000
    });

    console.log('Getting page content');
    // Get the rendered HTML
    const renderedHTML = await page.content();

    console.log('Rendered HTML length:', renderedHTML.length);
    return renderedHTML;
  } catch (error) {
    console.error('Error in getRenderedHTML:', error);
    return null;
  }
}

module.exports = getRenderedHTML;
