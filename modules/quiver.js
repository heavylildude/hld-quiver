const { Compiler } = require('./fin');
const readline = require('readline');
const { readFileSync, existsSync } = require('fs');

class QUIVER {
    constructor(options) {
        this.cargs = options.cargs || [];
        this.url = this.cargs[2] || "";
        this.currentResult = null;
        this.linkMap = new Map(); // Map to store link text -> URL mappings
    }
    
    async listen() {
        for (;;) {
            // Init page data
            let pageNum = 0;
            let selectedLinkIndex = -1;
            
            // Init screen
            this.clearScreen();
            process.title = "hld-quiver";
            
            // Waiting for URL or Search
            if (!this.url) {
                this.url = await new Promise((resolve) => {
                    const input = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout,
                        terminal: true
                    });
                    input.question(">> ", async (url) => {
                        resolve(url);
                        input.close();
                    });
                });
            }
            
            // Site load result
            let result, pages = [], allLinks = [], originalTextStream = "";
            try {
                // Check if user wants to search (pressed 's')
                const isSearch = this.url.toLowerCase().startsWith('s ');
                const actualUrl = isSearch ? this.url.slice(2).trim() : this.url;
                
                result = await this.load(actualUrl, isSearch);
                
                // Store result for link extraction
                this.currentResult = result;
                
                // Build link map from attachments
                this.buildLinkMap(result.options.attachments);
                
                // Extract ALL links for reference
                allLinks = this.extractLinks(result);
                
                // Store original text stream for regenerating pages
                originalTextStream = result.textStream;
                
                // Clear the search bar
                this.clearScreen();
                
                // Set console's title to site's title
                if (result.options.title !== "") {
                    process.title = "hld-quiver: " + result.options.title;
                } else {
                    process.title = "hld-quiver: " + actualUrl;
                }
                
                // Divide the site's content into multiple pages
                pages = this.getPages(originalTextStream);
                
                // Render the first page
                this.render(pages, pageNum, selectedLinkIndex);
            } catch (e) {
                this.url = "";
                console.log("Unexpected error: " + e.message);
                continue;
            }
            
            this.url = "";
            
            // Recalculate pages size when console resize
            process.stdout.on("resize", () => {
                pages = this.getPages(originalTextStream);
                
                if (pageNum >= pages.length) {
                    pageNum = pages.length - 1;
                }
                
                selectedLinkIndex = -1;
                this.clearScreen();
                this.render(pages, pageNum, selectedLinkIndex);
            });
            
            // Pause and wait for key presses
            await new Promise((resolve) => {
                process.stdin.setRawMode(true);
                process.stdin.resume();
                
                const keyEventListener = (data) => {
                    const key = data.toString();
                    
                    // Exit (Ctrl + C)
                    if (key === "\x03") {
                        process.stdin.removeListener("data", keyEventListener);
                        process.stdin.setRawMode(false);
                        process.stdin.pause();
                        process.exit(0);
                    }
                    // Exit to menu (Enter)
                    else if (key === "\r" || key === "\n") {
                        process.stdin.removeListener("data", keyEventListener);
                        process.stdin.setRawMode(false);
                        process.stdin.pause();
                        process.stdout.removeAllListeners("resize");
                        resolve();
                    }
                    // Scroll up
                    else if (key === "\x1B[A" && pageNum > 0) {
                        pageNum--;
                        selectedLinkIndex = -1;
                        this.clearScreen();
                        this.render(pages, pageNum, selectedLinkIndex);
                    }
                    // Scroll down
                    else if (key === "\x1B[B" && pageNum < pages.length - 1) {
                        pageNum++;
                        selectedLinkIndex = -1;
                        this.clearScreen();
                        this.render(pages, pageNum, selectedLinkIndex);
                    }
                    // Show links (Tab)
                    else if (key === "\t") {
                        this.clearScreen();
                        originalTextStream = result.options.attachments;
                        pages = this.getPages(originalTextStream);
                        pageNum = 0;
                        selectedLinkIndex = -1;
                        this.render(pages, pageNum, selectedLinkIndex);
                    }
                    // Previous link (A)
                    else if (key === "a" || key === "A" || key === "\x1B[D") {
                        pages = this.getPages(originalTextStream);
                        const visibleLinks = this.getLinksOnPage(pages[pageNum]);
                        
                        if (visibleLinks.length > 0) {
                            if (selectedLinkIndex <= 0) {
                                selectedLinkIndex = visibleLinks.length - 1;
                            } else {
                                selectedLinkIndex--;
                            }
                            
                            pages[pageNum] = this.addBracketsToLink(pages[pageNum], selectedLinkIndex);
                            this.clearScreen();
                            this.render(pages, pageNum, selectedLinkIndex);
                        }
                    }
                    // Next link (D)
                    else if (key === "d" || key === "D" || key === "\x1B[C") {
                        pages = this.getPages(originalTextStream);
                        const visibleLinks = this.getLinksOnPage(pages[pageNum]);
                        
                        if (visibleLinks.length > 0) {
                            if (selectedLinkIndex >= visibleLinks.length - 1) {
                                selectedLinkIndex = 0;
                            } else {
                                selectedLinkIndex++;
                            }
                            
                            pages[pageNum] = this.addBracketsToLink(pages[pageNum], selectedLinkIndex);
                            this.clearScreen();
                            this.render(pages, pageNum, selectedLinkIndex);
                        }
                    }
                    // Open highlighted link (Spacebar)
                    else if (key === " ") {
                        const visibleLinks = this.getLinksOnPage(pages[pageNum]);
                        
                        if (selectedLinkIndex >= 0 && selectedLinkIndex < visibleLinks.length) {
                            const selectedUrl = visibleLinks[selectedLinkIndex].url;
                            
                            // Only navigate if we found a valid URL
                            if (selectedUrl && selectedUrl !== null && selectedUrl !== "") {
                                process.stdin.removeListener("data", keyEventListener);
                                process.stdin.setRawMode(false);
                                process.stdin.pause();
                                process.stdout.removeAllListeners("resize");
                                
                                this.url = selectedUrl;
                                resolve();
                            }
                        }
                    }
                };
                
                process.stdin.on("data", keyEventListener);
            });
        }
    }
    
    // Get ONLY the links that are visible on the current page
    getLinksOnPage(pageLines) {
        const pageText = pageLines.join("\n");
        const links = [];
        
        // Remove the <<< >>> brackets if present (from selection)
        const cleanPageText = pageText.replace(/<<</g, '').replace(/>>>/g, '');
        
        // Match links with ANSI codes: \x1b[1;4mLINK_TEXT\x1b[0m
        const linkRegex = /\x1b\[1;4m(.*?)\x1b\[0m/g;
        let match;
        let linkIndex = 0;
        
        while ((match = linkRegex.exec(cleanPageText)) !== null) {
            const linkText = match[1];
            const url = this.findUrlForLinkText(linkText, linkIndex);
            
            // Only add links that have valid URLs
            if (url && url !== null && url !== "") {
                links.push({
                    text: linkText,
                    url: url,
                    index: linkIndex
                });
                linkIndex++;
            }
        }
        
        return links;
    }
    
    // Build a map of link text to URLs from attachments
    buildLinkMap(attachments) {
        this.linkMap.clear();
        
        // Split by lines to properly parse each link entry
        const lines = attachments.split('\n');
        
        for (const line of lines) {
            // Match format: "\x1b[1;4mURL\x1b[0m: DisplayText"
            const match = line.match(/\x1b\[1;4m(https?:\/\/[^\x1b]+)\x1b\[0m:\s*(.+)/);
            
            if (match) {
                const url = match[1].trim();
                const text = match[2].trim();
                
                // Store both the URL itself and the display text as keys
                if (url && url !== "" && url !== "#") {
                    this.linkMap.set(url, url);
                    if (text && text !== "") {
                        this.linkMap.set(text, url);
                    }
                }
            }
        }
    }
    
    // Find the actual URL for a link text
    findUrlForLinkText(linkText, linkIndex) {
        // Clean the link text (remove brackets if present)
        const cleanText = linkText.replace(/<<<|>>>/g, '').trim();
        
        // First try the map with cleaned text (most reliable)
        if (this.linkMap.has(cleanText)) {
            return this.linkMap.get(cleanText);
        }
        
        // Fallback: if it looks like a URL, return it as-is
        if (cleanText.startsWith('http://') || cleanText.startsWith('https://')) {
            return cleanText;
        }
        
        // If we can't find it, return null so we can handle it properly
        return null;
    }
    
    // Add triple brackets to a specific link on the page
    addBracketsToLink(pageLines, selectedIndex) {
        const pageText = pageLines.join("\n");
        const linkRegex = /(\x1b\[1;4m)(.*?)(\x1b\[0m)/g;
        let currentIndex = 0;
        
        const modifiedText = pageText.replace(linkRegex, (match, start, text, end) => {
            if (currentIndex === selectedIndex) {
                currentIndex++;
                return `${start}<<<${text}>>>${end}`;
            }
            currentIndex++;
            return match;
        });
        
        return modifiedText.split("\n");
    }
    
    // Extract all links from result
    extractLinks(result) {
        const links = [];
        const attachments = result.options.attachments;
        const urlRegex = /\x1b\[1;4m(https?:\/\/[^\x1b]+)\x1b\[0m:\s*(.+)/g;
        
        let match;
        while ((match = urlRegex.exec(attachments)) !== null) {
            links.push({
                url: match[1],
                text: match[2].trim()
            });
        }
        
        return links;
    }
    
    getPages(text) {
        const width = process.stdout.columns || 80;
        const height = (process.stdout.rows || 24) - 3;
        const pages = [[]];
        
        const originalLines = text.split("\n").map(line => this.strToLine(line));
        
        for (const line of originalLines) {
            if (line.length === 0) {
                if (pages[pages.length - 1].length >= height) {
                    pages.push([]);
                }
                pages[pages.length - 1].push("");
            } else {
                for (let i = 0; i < line.length; i += width) {
                    if (pages[pages.length - 1].length >= height) {
                        pages.push([]);
                    }
                    
                    let currentLine = line.slice(i, i + width);
                    let trueLength = currentLine.length;
                    let displayLength = this.getDisplayLength(currentLine);
                    let needToFulfill = trueLength - displayLength;
                    let extraChar = 0;
                    
                    for (let k = i + width; k < line.length; k++) {
                        if (needToFulfill === 0) break;
                        if (!this.isEscape(line[k])) {
                            needToFulfill--;
                        }
                        extraChar++;
                    }
                    
                    pages[pages.length - 1].push(line.slice(i, i + width + extraChar).join(""));
                    i += extraChar;
                }
            }
        }
        
        while (pages[pages.length - 1].length < height) {
            pages[pages.length - 1].push("");
        }
        
        return pages;
    }
    
    render(pages, pageNum, selectedLinkIndex) {
        const visibleLinks = this.getLinksOnPage(pages[pageNum] || []);
        const linkInfo = visibleLinks.length > 0 && selectedLinkIndex >= 0 
            ? ` | Link ${selectedLinkIndex + 1}/${visibleLinks.length}` 
            : visibleLinks.length > 0 
            ? ` | ${visibleLinks.length} link(s) on page`
            : "";
        
        console.log((pages[pageNum] || []).join("\n") +
            "\x1b[0m\n\n[Enter] to exit, [Up/Down] to scroll, [Tab] to show links, [Left/Right] prev/next link, [Space] open link" + linkInfo);
    }
    
    clearScreen() {
        process.stdout.write("\x1b[H\x1b[2J\x1b[3J\x1bc");
    }
    
    strToLine(str) {
        return str.match(/\x1b\[[0-9;]*m|./g) || [];
    }
    
    getDisplayLength(str) {
        let length = 0;
        for (const char of str) {
            length += char.replace(/\x1b\[[0-9;]*m/g, "").length;
        }
        return length;
    }
    
    isEscape(char) {
        return char.replace(/\x1b\[[0-9;]*m/g, "").length === 0;
    }
    
    async load(url, isSearch = false) {
        let code = "";
        let urlTrimStart = url.trimStart();
        
        // Handle search mode explicitly
        if (isSearch) {
            const finalUrl = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(url);
            const response = await fetch(finalUrl);
            code = await response.text();
        }
        // Handle local html files
        else if (urlTrimStart.startsWith("file:///")) {
            code = readFileSync(urlTrimStart.slice(8)).toString("utf8");
        } else if (existsSync(url)) {
            code = readFileSync(url).toString("utf8");
        }
        // Handle html files served through https/http - ALWAYS try to load as URL
        else {
            const offset = urlTrimStart.startsWith("https://") || urlTrimStart.startsWith("http://") ? "" : "https://";
            const finalUrl = offset + url;
            
            const response = await fetch(finalUrl);
            const contentType = response.headers.get("content-type");
            
            if (contentType && contentType.includes("text/html")) {
                code = await response.text();
            } else {
                throw new Error("Unsupported content type.");
            }
        }
        
        const compiler = new Compiler();
        const result = compiler.interpret(compiler.parse(compiler.tokenize(code)));
        
        return result;
    }
}

module.exports = { QUIVER };