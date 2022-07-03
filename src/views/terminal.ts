import { html, unsafeHTML } from "@worker-tools/html";

const BANNER = `                 _                                
_ __  _ __ ___  | | ___   __ _   _ __ _   _ _ __  
| '_ \\| '__/ _ \\| |/ _ \\ / _\` | | '__| | | | '_ \\ 
| |_) | | | (_) | | (_) | (_| |_| |  | |_| | | | |
| .__/|_|  \\___/|_|\\___/ \\__, (_)_|   \\__,_|_| |_|
|_|                      |___/                    

`;

export const terminalJS = html`
<script type="module">
	import xterm from "https://esm.sh/xterm";
	import fitpkg from "https://esm.sh/xterm-addon-fit";

	console.log("fit", fitpkg.FitAddon);

	function cols() {
		return Math.floor(window.innerWidth/16 * 4/5);
	}
	function rows() {
		return Math.floor(window.innerHeight/16 * 2/5);
	}

	const elem = document.getElementById('terminal');
	if (elem) {
		initTerm(elem);
	}

	function initTerm(elem) {
		const term = new xterm.Terminal({convertEol: true, cols: cols(), rows: rows()});
		const fitter = new fitpkg.FitAddon();
		term.loadAddon(fitter);
		term.open(elem);
		term.write(decodeURIComponent("${unsafeHTML(encodeURIComponent(BANNER))}"));
		window.term = term;
		window.addEventListener("resize", function() {
			fitter.fit();
		})
		fitter.fit();
	}

</script>`;

