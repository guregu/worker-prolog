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
	// import imgpkg from "https://esm.sh/xterm-addon-image";
	// const WORKER_PATH = "/worker.js";
	// https://unpkg.com/xterm-addon-image@0.1.0/lib/xterm-addon-image-worker.js
	// https://esm.sh/xterm-addon-image@0.1.0/lib/xterm-addon-image-worker

	const elem = document.getElementById('terminal');
	if (elem) {
		initTerm(elem);
	}

	function initTerm(elem) {
		const term = new xterm.Terminal({convertEol: true});
		const fitter = new fitpkg.FitAddon();
		term.loadAddon(fitter);
		// const imageAddon = new imgpkg.ImageAddon(WORKER_PATH, {});
		// term.loadAddon(imageAddon);
		term.open(elem);
		term.write(decodeURIComponent("${unsafeHTML(encodeURIComponent(BANNER))}"));
		window.term = term;
		window.addEventListener("resize", function() {
			fitter.fit();
		})
		fitter.fit();
	}

</script>`;

