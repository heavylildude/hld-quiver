# hld-quiver: The Gnarliest Text-Based Web Browser 🤙

Welcome to the guts of `hld-quiver`, ya legend. This ain't your grandma's web browser. This is a lean, mean, text-surfing machine built for hackers, minimalist legends, and anyone who's sick of the bloated, corporate web. Think of it as a surfboard for the digital ocean, cutting through the bullshit and riding the pure waves of HTML.

## Inspo  
This whole project surfed in on the basic idea from `smolsurf` (check it at https://github.com/nguyenphuminh/smolsurf), but we've paddled way out from there. We took that kernel of an idea, ditched the TypeScript, and rebuilt the whole damn thing in clean, vanilla JavaScript with zero dependencies. Fucking rad. Huge kudos to [nguyenphuminh](https://github.com/nguyenphuminh) for sparking the flame, that dude's a legend.

The biggest change? We added full link-following functions. The original couldn't highlight or follow a link to save its life. We took a page from the book of the old-school `lynx` browser, letting you cycle through links on the page and jump from one wave to the next without ever touching a mouse. It's all about that keyboard-driven flow state.

## The Engine Room: A Hacker's Tours

This is where the magic happens. The whole app is split into two main parts: the **Quiver** and the **Fin**.

### `modules/quiver.js` - The Set

This file, which contains the main `QUIVER` class, is the user-facing part. It handles all your input, manages the state of the browser, and paints the text on your screen.

#### The Main Loop: `listen()`
This is the heart of the beast. It's a gnarly `for(;;)` infinite loop that keeps the browser session alive. Inside this loop, it does everything:
1.  Waits for you to enter a URL or search query.
2.  Calls `load()` to fetch and process the content.
3.  Handles all the post-load user interaction (scrolling, link navigation).
4.  When you're done with a page (hit `Enter`), the loop repeats, ready for the next URL. It's a state machine, pure and simple.

#### Fetching the Goods: `load(url, isSearch)`
This function is the workhorse. It figures out what you typed in and goes and gets it.
*   **Search:** If you start with `s `, it knows you're on the hunt. It crafts a URL for DuckDuckGo's HTML-only search (`https://html.duckduckgo.com/html/`) and fetches the results. Simple, private, no bullshit.
*   **Local Files:** If you give it a path like `file:///...` or a local path it can find with `existsSync`, it just reads the file straight from your disk. Easy.
*   **Web URLs:** For everything else, it assumes it's a web URL. It slaps `https://` on the front if you forgot and uses Node's built-in `fetch` to grab the page. It's even smart enough to check the `content-type` header to make sure it's actually getting HTML before it tries to render, preventing it from shitting the bed on a PNG or something.

Once it has the raw HTML, it passes it to the `Compiler` to be shredded.

#### Link Surfing: The `lynx`-style Magic in `quiver.js`
This is the secret sauce. Here's how you can hop from page to page:
*   **`buildLinkMap(attachments)`**: After the `engine` interprets the page, it returns a list of all links in the `attachments`. This function builds a `Map` where the keys are the link's display text (what you see on the screen) and the values are the actual URLs. This creates a quick lookup table.
*   **`getLinksOnPage(pageLines)`**: This function scans the *currently visible* page of text for anything that looks like a link (i.e., underlined text). It then uses the `linkMap` to find the corresponding URL for each piece of link text. This is crucial—it only cares about what you can see.
*   **`addBracketsToLink(pageLines, selectedIndex)`**: When you press `A` or `D` to cycle through links, this function gets called. It finds the Nth link on the page and wraps it in our signature `<<< >>>` markers. It's a purely visual thing to show you what's selected.
*   **Key Events**: The `process.stdin.on('data', ...)` listener is in raw mode, capturing every keystroke.
    *   `A`/`D` or `Left`/`Right` arrows decrement/increment `selectedLinkIndex` and re-render the page with the newly highlighted link.
    *   `Spacebar` grabs the URL of the currently selected link from the `visibleLinks` array and sets it as the `this.url` for the *next* iteration of the main `listen()` loop. It then breaks the current key listener promise, which effectively triggers a page load for the new URL. Fucking elegant.

#### Pagination and Rendering
*   **`getPages(text)`**: This function is a wicked little piece of code. It takes the entire text stream from the engine and chops it into pages that fit your terminal window. The clever part is how it handles ANSI escape codes for colors and formatting. It calculates the *display length* of a line, ignoring the invisible ANSI characters, to make sure text wraps correctly.
*   **`process.stdout.on("resize", ...)`**: This is a deadset legend move. It hooks into the terminal's resize event. If you drag your terminal window to make it bigger or smaller, it automatically re-runs `getPages()` to re-calculate the pagination on the fly. No more cooked layouts.
*   **`render()`**: This just spits the current page's text to the console, along with the footer showing the key commands and the status of any links on the page.

### `modules/fin.js` - The HTML Shredder

This is the real soul of the machine. It's a custom-built HTML parser and interpreter, written from scratch. It doesn't bother with the whole DOM tree bullshit from a normal browser. It's a three-stage pipeline designed to do one thing: rip the meaningful text out of HTML and discard the rest.

#### Stage 1: `tokenize(input)`
The tokenizer is a state machine that scans the raw HTML string character by character and breaks it into a flat list of "tokens".
*   **Pre-processing:** First, it uses some cheeky regular expressions to rip out all the `<script>` and `<style>` tags. We don't need that JavaScript and CSS garbage. It also strips the `<!DOCTYPE>`.
*   **State Flags:** It uses flags like `isComment`, `stringType`, and `isText` to keep track of what it's currently parsing. This is how it knows whether a `<` character is the start of a new tag or just part of some text content.
*   **Token Types:** It generates tokens with types like `punc` (for `<`, `>`, `/`, `=`), `identifier` (for tag names and attributes), `string` (for attribute values in quotes), and `text` (for the actual content you want to read).

#### Stage 2: `parse(tokens)`
This stage is a stack-based parser. It takes the flat list of tokens and organizes them into a tree structure (an Abstract Syntax Tree, or AST).
*   **The `bodies` Stack:** It uses an array called `bodies` as a stack. When it sees an opening tag (`<p>`), it pushes a new node object onto the stack.
*   **Building Nodes:** It populates the node's `name`, `attributes`, and `children`. It's smart enough to look ahead to see if an identifier is an attribute with a value (`href="..."`) or a boolean attribute (`disabled`).
*   **Closing Tags:** When it finds a closing tag (`</p>`), it walks back up the stack to find the matching opening tag. It then pops all the children that came after that opening tag, assigns them to the `children` array of the parent tag, and collapses the stack.
*   **Self-Closing Tags:** It also handles self-closing tags like `<br />`.
The result is a tree of nested objects, where each object represents an HTML element.

#### Stage 3: `interpret(ast)`
This is the final step. It's a recursive function that "walks" the AST and builds the final text output.
*   **`getContent(el)`**: This recursive function traverses the tree. It calls itself on all children of a node, gets their text content back, and then decides what to do based on the parent node's tag name.
*   **The `switch` Statement:** A massive `switch (childEl.name.toLowerCase())` block is the brain of the interpreter. It defines the rendering rules for each HTML tag:
    *   **Block-level tags** (`p`, `div`, `h1`, etc.) add newlines (`\n` or `\n\n`) before and after their content to create vertical space.
    *   **Formatting tags** (`b`, `i`, `u`, `strong`) wrap their content in ANSI escape codes for **bold** (`\x1b[1m`), *italic* (`\x1b[3m`), and `underline` (`\x1b[4m`).
    *   **`<a>` tags** are special. Their text content is underlined, and a new entry is added to `final.options.attachments` in the format `URL: Text`. This is the data that `cli.js` later uses to build its `linkMap`.
    *   **`<li>` tags** get a `•` or a number prepended, depending on whether they are in a `<ul>` or `<ol>`.
    *   A bunch of tags are just ignored (`template`, `script`, etc.) because they're useless for a text-based view.
*   **`sanitize(text)`**: A helper function that cleans up text content by collapsing whitespace and decoding HTML entities like `&amp;` into `&` (using the `encoding.js` helper).

The interpreter returns a final object containing the `textStream` (the good stuff you read) and `options` (like the page `title` and the `attachments` list of links). This object is what gets passed back to `quiver.js` for pagination and rendering.

## The Philosophy

This project is a statement. It's about taking back control. The modern web is a bloated, slow, privacy-invading mess. `hld-quiver` is the elegant backdoor. It slips past all the corporate tracking scripts, the pop-up ads, and the megabytes of JavaScript framework bullshit. It gets right to the information. It's fast, it's private, and it's yours to command.

Now go get pitted!
