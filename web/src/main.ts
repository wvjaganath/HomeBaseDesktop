// Self-hosted fonts (no CDN). Latin subsets only, to keep the CSS small on the Pi.
import '@fontsource-variable/instrument-sans/wght.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/dotgothic16/latin-400.css';
import './styles/app.css';
import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('#app missing');
mount(App, { target });
