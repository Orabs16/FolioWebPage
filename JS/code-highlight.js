// tiny C# highlighter - no library, just enough regex to colour a snippet.
// Mark a block up as <pre class="code-block"><code data-lang="csharp">...</code></pre>
// and write the code as plain text; this does the rest on load.

(function () {
    const KEYWORDS = new Set([
        "private", "public", "protected", "internal", "static", "readonly", "const",
        "void", "bool", "int", "uint", "long", "ulong", "float", "double", "byte", "var",
        "for", "foreach", "while", "if", "else", "return", "new", "true", "false", "null",
        "struct", "class", "ref", "out", "in", "unsafe", "fixed", "break", "continue"
    ]);

    // order matters: first match wins at each position
    const TOKEN = new RegExp([
        "(\\/\\/[^\\n]*)",                        // 1 comment
        "(\"(?:[^\"\\\\]|\\\\.)*\")",             // 2 string
        "(\\b\\d+(?:\\.\\d+)?[uUlLfF]{0,2}\\b)",  // 3 number, with 1u / 64UL suffixes
        "(<<=|>>=|<<|>>|&&|\\|\\||[+\\-*/%]=?|[!=<>]=?|\\?|:)", // 4 operator
        "([A-Za-z_]\\w*)"                         // 5 identifier
    ].join("|"), "g");

    const escape = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const wrap = (cls, s) => `<span class="tok-${cls}">${escape(s)}</span>`;

    function classify(word, rest) {
        if (KEYWORDS.has(word)) return "kw";
        if (/^[A-Z][A-Z0-9_]+$/.test(word)) return "const";   // SUBDIVIDEBOX
        if (/^\s*\(/.test(rest)) return "fn";                 // CheckBox(
        if (/^[A-Z]/.test(word)) return "type";               // Physics, Vector3
        return null;
    }

    function highlight(src) {
        let out = "";
        let last = 0;
        for (const m of src.matchAll(TOKEN)) {
            out += escape(src.slice(last, m.index));
            last = m.index + m[0].length;

            if (m[1]) out += wrap("comment", m[1]);
            else if (m[2]) out += wrap("str", m[2]);
            else if (m[3]) out += wrap("num", m[3]);
            else if (m[4]) out += wrap("op", m[4]);
            else {
                const cls = classify(m[5], src.slice(last));
                out += cls ? wrap(cls, m[5]) : escape(m[5]);
            }
        }
        return out + escape(src.slice(last));
    }

    document.querySelectorAll('code[data-lang="csharp"]').forEach(el => {
        el.innerHTML = highlight(el.textContent);
    });
})();
