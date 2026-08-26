import { render } from 'preact';
import { App } from './app';
import './popup.css';

const root = document.getElementById('root');
if (root !== null) render(<App />, root);
