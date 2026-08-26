import { render } from 'preact';
import { Shell } from './shell';
import './options.css';

const root = document.getElementById('root');
if (root !== null) render(<Shell />, root);
