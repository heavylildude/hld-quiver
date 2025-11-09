const { decodeHtmlEntities } = require('./encoding');

class Compiler {
    tokenize(input) {
        // Blud I'm too lazy to implement proper SGML for now
        input = input.replace(/<!DOCTYPE\s+html.*?>/gi, "");
        
        // Blud I'm too lazy to parse JS and CSS for now
        input = input.replace(/<script[^>]*?>[\s\S]*?<\/script\s*>/gi, "")
            .replace(/<style[^>]*?>[\s\S]*?<\/style\s*>/gi, "");
        
        const tokens = [];
        
        // Stores identifier or string values
        let temp = "";
        
        // A flag used to record string tokens
        let stringType = "";
        
        // A flag used to record comments
        let isComment = false;
        
        // A flag used to record text
        let isText = false;
        
        // Variable to record current line num, used for errors
        let currentLine = 1;
        let column = 1;
        
        for (let pointer = 0; pointer < input.length; pointer++) {
            const prevChar = input[pointer - 1];
            const char = input[pointer];
            const nextChar = input[pointer + 1];
            
            // New line
            if (char === "\n") {
                currentLine++;
                column = 1;
            }
            
            // Handle comments
            if (isComment) {
                if (input.slice(pointer, pointer + 3) === "-->") {
                    isComment = false;
                    pointer = pointer + 2;
                }
                continue;
            }
            
            // Handle strings
            if (stringType !== "") {
                if (char === stringType && prevChar !== "\\") {
                    stringType = "";
                    tokens.push({
                        type: "string",
                        value: temp,
                        line: currentLine,
                        col: column
                    });
                    temp = "";
                } else {
                    temp += char;
                }
                continue;
            }
            
            // Handle text
            if (isText) {
                if (char === "<") {
                    isText = false;
                    tokens.push({
                        type: "text",
                        value: temp,
                        line: currentLine,
                        col: column
                    });
                    temp = "";
                } else {
                    temp += char;
                    continue;
                }
            }
            
            switch (char) {
                case "<":
                case ">":
                case "/":
                case "=": {
                    // Comments
                    if (input.slice(pointer, pointer + 4) === "<!--") {
                        isComment = true;
                        pointer = pointer + 3;
                    } else {
                        tokens.push({
                            type: "punc",
                            value: char,
                            line: currentLine,
                            col: column
                        });
                        
                        if (char === ">") {
                            isText = true;
                        }
                    }
                    break;
                }
                
                case "\"":
                case "'": {
                    stringType = char;
                    break;
                }
                
                default:
                    if (!(/[ \t\n\f\r"'=<>]/.test(char))) {
                        temp += char;
                        
                        if (nextChar === " " || nextChar === "\t" || nextChar === "\n" ||
                            nextChar === "\f" || nextChar === "\r" || nextChar === ">" ||
                            nextChar === "<" || nextChar === "/" || nextChar === "=") {
                            tokens.push({
                                type: "identifier",
                                value: temp,
                                line: currentLine,
                                col: column
                            });
                            temp = "";
                        }
                    }
            }
            column++;
        }
        
        // Handle the case where there still might be text left
        if (isText) {
            tokens.push({
                type: "text",
                value: temp,
                line: currentLine,
                col: column
            });
        }
        
        return tokens;
    }
    
    parse(tokens) {
        const ast = [];
        let bodies = [];
        
        for (let count = 0; count < tokens.length; count++) {
            const token = tokens[count];
            
            if (bodies.length === 0) {
                switch (token.type) {
                    case "identifier":
                    case "text":
                        ast.push(token.value);
                        break;
                    case "string":
                        ast.push(`"${token.value}"`);
                        break;
                    case "punc":
                        if (token.value === "<") {
                            bodies.push({
                                name: "",
                                attributes: {},
                                children: [],
                                stage: "name"
                            });
                        }
                        break;
                }
            } else {
                const currentEl = bodies[bodies.length - 1];
                
                switch (token.type) {
                    case "identifier":
                        if (typeof currentEl !== "string" && currentEl.stage === "name" && currentEl.name === "") {
                            currentEl.name = token.value;
                            currentEl.stage = "attr";
                        } else if (typeof currentEl !== "string" && currentEl.stage === "attr") {
                            const supposedEqual = tokens[count + 1];
                            const supposedValue = tokens[count + 2];
                            
                            if (supposedEqual?.type === "punc" && supposedEqual?.value === "=" &&
                                (supposedValue?.type === "string" || supposedValue?.type === "identifier")) {
                                currentEl.attributes[token.value] = supposedValue.value;
                                count += 2;
                            } else {
                                currentEl.attributes[token.value] = true;
                            }
                        } else if ((typeof currentEl !== "string" && currentEl.stage === "body") ||
                                   typeof currentEl === "string") {
                            bodies.push(token.value);
                        }
                        break;
                        
                    case "string":
                        if ((typeof currentEl !== "string" && currentEl.stage === "body") ||
                            typeof currentEl === "string") {
                            bodies.push(`"${token.value}"`);
                        }
                        break;
                        
                    case "text":
                        if ((typeof currentEl !== "string" && currentEl.stage === "body") ||
                            typeof currentEl === "string") {
                            bodies.push(token.value);
                        }
                        break;
                        
                    case "punc":
                        if ((typeof currentEl !== "string" && currentEl.stage === "body") ||
                            typeof currentEl === "string") {
                            if (token.value === "<") {
                                const supposedClosing = tokens[count + 1];
                                const supposedTag = tokens[count + 2];
                                const supposedEnd = tokens[count + 3];
                                
                                if (supposedClosing?.type === "punc" && supposedClosing?.value === "/") {
                                    if (supposedTag?.type === "identifier" &&
                                        supposedEnd?.type === "punc" && supposedEnd?.value === ">") {
                                        for (let index = bodies.length - 1; index >= 0; index--) {
                                            const el = bodies[index];
                                            if (typeof el !== "string" && !el.strictlySingular &&
                                                supposedTag.value === el.name) {
                                                el.children.push(...bodies.slice(index + 1, bodies.length));
                                                bodies.splice(index + 1, bodies.length);
                                                break;
                                            }
                                        }
                                    }
                                    count += 3;
                                    
                                    if (bodies.length === 1) {
                                        ast.push(bodies.pop());
                                    }
                                } else {
                                    bodies.push({
                                        name: "",
                                        attributes: {},
                                        children: [],
                                        stage: "name"
                                    });
                                }
                            }
                        }
                        
                        if (token.value === "/" && typeof currentEl !== "string" && currentEl.stage !== "body") {
                            const supposedEnd = tokens[count + 1];
                            if (supposedEnd?.type === "punc" && supposedEnd?.value === ">") {
                                currentEl.stage = "body";
                                currentEl.strictlySingular = true;
                                count += 1;
                                
                                if (bodies.length === 1) {
                                    ast.push(bodies.pop());
                                }
                            }
                        }
                        
                        if (token.value === ">" && typeof currentEl !== "string") {
                            currentEl.stage = "body";
                        }
                        break;
                }
            }
        }
        
        ast.push(...bodies);
        return ast;
    }
    
    interpret(ast) {
        const final = {
            textStream: "",
            options: {
                attachments: "Here are some links found in the site which you can copy and search:\n\n",
                title: ""
            }
        };
        
        const astNode = {
            name: "AST",
            attributes: {},
            children: ast,
            stage: "body"
        };
        
        const { textStream, options } = this.getContent(astNode);
        final.textStream += textStream;
        final.options.title = options.title || final.options.title;
        final.options.attachments += options.attachments || "";
        
        return final;
    }
    
    getContent(el) {
        const final = { textStream: "", options: { attachments: "" } };
        
        let listIndex = 1;
        let suffix = "";
        
        for (let index = 0; index < el.children.length; index++) {
            const childEl = el.children[index];
            const noANSIStream = this.removeANSICode(final.textStream);
            const lastWrittenChar = noANSIStream[noANSIStream.length - 1];
            const noPrefix = index === 0 || noANSIStream.length === 0;
            
            if (typeof childEl === "string") {
                const trimStart = index === 0 || suffix !== "" || /\n| /.test(lastWrittenChar) || noANSIStream.length === 0;
                const trimEnd = index === el.children.length - 1;
                const textStream = this.sanitize(childEl, trimStart, trimEnd);
                
                if (textStream !== "") {
                    const prefix = this.getPrefix("", suffix, noPrefix);
                    final.textStream += prefix + textStream;
                    suffix = "";
                }
                continue;
            }
            
            const { textStream, options } = this.getContent(childEl);
            final.options.title = options.title || final.options.title;
            final.options.attachments += options.attachments || "";
            
            switch (childEl.name.toLowerCase()) {
                case "title":
                    final.options.title = textStream;
                    break;
                    
                case "p":
                case "ul":
                case "ol":
                    if (textStream !== "") {
                        const prefix = this.getPrefix("\n\n", suffix, noPrefix);
                        final.textStream += `${prefix}${textStream}`;
                        suffix = "\n\n";
                    }
                    break;
                    
                case "h1":
                case "h2":
                case "h3":
                case "h4":
                case "h5":
                case "h6":
                    if (textStream !== "") {
                        const prefix = this.getPrefix("\n\n", suffix, noPrefix);
                        final.textStream += `${prefix}\x1b[1m${textStream}\x1b[0m`;
                        suffix = "\n\n";
                    }
                    break;
                    
                case "br":
                case "hr":
                    const prefix = this.getPrefix("", suffix, noPrefix);
                    final.textStream += `${prefix}\n`;
                    suffix = "";
                    break;
                    
                case "div":
                case "section":
                case "article":
                    if (textStream !== "") {
                        const prefix = this.getPrefix("\n", suffix, noPrefix);
                        final.textStream += `${prefix}${textStream}`;
                        suffix = "\n";
                    }
                    break;
                    
                case "li": {
                    const prefix = this.getPrefix("\n", suffix, noPrefix);
                    let listStyle = "•";
                    if (el.name === "ol") {
                        listStyle = listIndex.toString() + ".";
                        listIndex++;
                    }
                    final.textStream += `${prefix}${listStyle} ${textStream}`;
                    suffix = textStream !== "" ? "\n" : "";
                    break;
                }
                
                case "img": {
                    const prefix = this.getPrefix("", suffix, noPrefix);
                    final.textStream += prefix + (typeof childEl.attributes.alt === "string" ? childEl.attributes.alt : textStream);
                    suffix = "";
                    break;
                }
                
                case "b":
                case "strong":
                    if (textStream !== "") {
                        const prefix = this.getPrefix("", suffix, noPrefix);
                        final.textStream += `${prefix}\x1b[1m${textStream}\x1b[0m`;
                        suffix = "";
                    }
                    break;
                    
                case "i":
                case "cite":
                    if (textStream !== "") {
                        const prefix = this.getPrefix("", suffix, noPrefix);
                        final.textStream += `${prefix}\x1b[3m${textStream}\x1b[0m`;
                        suffix = "";
                    }
                    break;
                    
                case "u":
                    if (textStream !== "") {
                        const prefix = this.getPrefix("", suffix, noPrefix);
                        final.textStream += `${prefix}\x1b[4m${textStream}\x1b[0m`;
                        suffix = "";
                    }
                    break;
                    
                case "strike":
                    if (textStream !== "") {
                        const prefix = this.getPrefix("", suffix, noPrefix);
                        final.textStream += `${prefix}\x1b[9m${textStream}\x1b[0m`;
                        suffix = "";
                    }
                    break;
                    
                case "q": {
                    const prefix = this.getPrefix("", suffix, noPrefix);
                    final.textStream += `${prefix}\u201C${textStream}\u201D`;
                    suffix = "";
                    break;
                }
                
                case "mark":
                    if (textStream !== "") {
                        const prefix = this.getPrefix("", suffix, noPrefix);
                        final.textStream += `${prefix}\x1b[7m${textStream}\x1b[27m`;
                        suffix = "";
                    }
                    break;
                    
                case "a":
                    if (textStream !== "") {
                        if (typeof childEl.attributes.href === "string") {
                            // Filter out target attribute - we only care about href
                            const href = childEl.attributes.href;
                            
                            // Only add to attachments if href is valid and not just "#" or empty
                            if (href && href !== "#" && href.trim() !== "") {
                                final.options.attachments += `\x1b[1;4m${href}\x1b[0m: ${textStream}\n`;
                            }
                        }
                        const prefix = this.getPrefix("", suffix, noPrefix);
                        final.textStream += `${prefix}\x1b[1;4m${textStream}\x1b[0m`;
                        suffix = "";
                    }
                    break;
                    
                case "template":
                    break;
                    
                default:
                    if (textStream !== "") {
                        const prefix = this.getPrefix("", suffix, noPrefix);
                        final.textStream += prefix + textStream;
                        suffix = "";
                    }
            }
        }
        
        return final;
    }
    
    sanitize(text, trimStart, trimEnd) {
        let processedText = text
            .replaceAll("\r", "")
            .replaceAll("\f", "")
            .replaceAll("\n", " ")
            .replaceAll("\t", " ")
            .replace(/\s+/g, " ");
        
        processedText = trimStart ? processedText.trimStart() : processedText;
        processedText = trimEnd ? processedText.trimEnd() : processedText;
        
        return decodeHtmlEntities(processedText);
    }
    
    getPrefix(prefix, suffix, trim) {
        if (trim) return "";
        return prefix.length > suffix.length ? prefix : suffix;
    }
    
    removeANSICode(text) {
        return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
    }
}

module.exports = { Compiler };