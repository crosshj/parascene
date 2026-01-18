// Global components that all pages will use
import './components/header.js';
import './components/profile.js';
import './components/notifications.js';
import './components/nav-bar.js';
import './components/pages/feed.js';
import './components/pages/explore.js';
import './components/pages/servers.js';
import './components/pages/creations.js';
import './components/pages/create.js';
import './components/pages/templates.js';
import './components/pages/provider-status.js';
import './components/pages/provider-metrics.js';
import './components/pages/provider-grants.js';
import './components/pages/provider-templates.js';

// Wait for DOM and custom elements to be ready before showing content
async function initPage() {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    await new Promise(resolve => {
      document.addEventListener('DOMContentLoaded', resolve);
    });
  }

  // Wait for all custom elements to be defined
  const customElementTags = [
    'app-header',
    'app-profile',
    'app-notifications',
    'app-route-feed',
    'app-route-explore',
    'app-route-creations',
    'app-route-servers',
    'app-route-create',
    'app-route-templates',
    'app-route-provider-status',
    'app-route-provider-metrics',
    'app-route-provider-grants',
    'app-route-provider-templates'
  ];
  await Promise.all(
    customElementTags.map(tag => customElements.whenDefined(tag))
  );

  // Small delay to ensure components are fully initialized and rendered
  await new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });

  // Show the page
  document.body.classList.add('loaded');
}

initPage();