import { html}  from "@worker-tools/html";

export const indexStyle = html`
<style>
    html {
        color: #000;
        background: #fff;
        overflow-y: scroll;
        -webkit-text-size-adjust: 100%;
        -ms-text-size-adjust: 100%
    }

    html * {
        outline: 0;
        -webkit-text-size-adjust: none;
        -webkit-tap-highlight-color: rgba(0, 0, 0, 0)
    }

    body {
        margin: 0;
        font-family: sans-serif;
    }

    body > *:not(#query) {
        margin: 8px;
    }

    a, a:visited {
        color: black;
        text-decoration-thickness: from-font;
    }

    header h1 a, header h1 a:visited {
        text-decoration: none;
    }
    header h1 a:hover {
        text-decoration: underline;
    }

    .error {
        color: red;
    }

    #query {
        position: sticky;
        top: 0;
        background: #f7f7f7b3;
        backdrop-filter: blur(var(--frost-blur, 6px));
        margin: 0;
        padding-left: 8px;
        padding-right: 8px;
    }

    #query form {
        padding-bottom: 0.5em;
        display: flex;
        align-items: center;
    }
    #query form > * {
        margin-top: 5px;
        margin-right: 5px;
    }
    #query form label[for=ask] {
        font-size: large;
        font-family: monospace;
    }
    #query form #ask {
        flex: 1;
        max-width: 80ch;
    }


    #src_text {
        width: 80ch;
        height: 24ch;
        max-width: calc(100% - 8px);
    }

    section {
        margin: 0.3em;
    }

    details {
        border: 1px dotted lightgrey;
        max-width: 100%;
    }
    details.dump {
        overflow-y: auto;
    }
    details summary {
        background: #efefeb;
        padding: 0.3em;
    }
    details > *:not(summary) {
        margin: 0.3em;
    }

    input, textarea {
        font-size: 16px;
    }

    .answer.false {
        color: crimson;
    }
    .time-taken {
        color: gray;
    }

    table.form {
        width: 98%;
    }
    table.form td:first-of-type{
        width: 15ch;
    }

    #results table {
        border-collapse: collapse;
        margin: 1px;
    }
    #results th, #results td {
        border: 1px solid lightgrey;
        padding: 0.3em;
    }

    footer {
        padding-top: 1em;
        text-align: center;
        color: #bdbdbd;
    }
    footer a, footer a:visited {
        /* text-decoration: none; */
        color: #b5a7c9;
    }
</style>`;