const LOGO_STYLES = `
  .gt-logo-root {
    display: inline-block;
    line-height: 0;
  }
  .gt-stem {
    stroke-dasharray: 60;
    stroke-dashoffset: 60;
    animation: gt-grow-stem 0.8s ease-out forwards;
  }
  .gt-leaf-left {
    transform-origin: 18px 30px;
    transform: scale(0) rotate(-20deg);
    animation: gt-sprout-leaf 0.5s ease-out 0.6s forwards;
  }
  .gt-leaf-right {
    transform-origin: 22px 22px;
    transform: scale(0) rotate(20deg);
    animation: gt-sprout-leaf 0.5s ease-out 0.8s forwards;
  }
  .gt-leaf-top {
    transform-origin: 20px 10px;
    transform: scale(0);
    animation: gt-sprout-leaf 0.5s ease-out 1.0s forwards;
  }
  .gt-leaf-mid-left {
    transform-origin: 14px 20px;
    transform: scale(0) rotate(-15deg);
    animation: gt-sprout-leaf 0.5s ease-out 1.1s forwards;
  }
  .gt-leaf-mid-right {
    transform-origin: 26px 18px;
    transform: scale(0) rotate(15deg);
    animation: gt-sprout-leaf 0.5s ease-out 1.2s forwards;
  }
  .gt-soil {
    opacity: 0;
    animation: gt-fade-in 0.4s ease-out 0.1s forwards;
  }
  .gt-sparkle {
    opacity: 0;
    animation: gt-sparkle-pop 0.4s ease-out 1.3s forwards;
  }
  @keyframes gt-grow-stem {
    to { stroke-dashoffset: 0; }
  }
  @keyframes gt-sprout-leaf {
    to { transform: scale(1) rotate(0deg); }
  }
  @keyframes gt-fade-in {
    to { opacity: 1; }
  }
  @keyframes gt-sparkle-pop {
    0% { opacity: 0; transform: scale(0); }
    60% { opacity: 1; transform: scale(1.3); }
    100% { opacity: 1; transform: scale(1); }
  }
`;

function buildLogoSVG(scale = 1) {
  const size = Math.round(40 * scale);
  const stages = Math.ceil(scale * 3);

  const stemPath = 'M20 44 Q20 32 20 18';
  const soilRect = `<ellipse cx="20" cy="45" rx="12" ry="4" fill="#6B4F2A" class="gt-soil" opacity="0.85"/>`;

  const leafLeftSmall = `<path d="M20 30 Q10 24 12 16 Q18 20 20 30Z" fill="#22C55E" class="gt-leaf-left"/>`;
  const leafRightSmall = `<path d="M20 22 Q30 16 28 8 Q22 12 20 22Z" fill="#16A34A" class="gt-leaf-right"/>`;
  const leafTop = stages >= 2
    ? `<path d="M20 10 Q14 2 20 0 Q26 2 20 10Z" fill="#4ADE80" class="gt-leaf-top"/>`
    : '';
  const leafMidLeft = stages >= 3
    ? `<path d="M20 20 Q8 16 8 8 Q14 14 20 20Z" fill="#22C55E" class="gt-leaf-mid-left"/>`
    : '';
  const leafMidRight = stages >= 3
    ? `<path d="M20 18 Q32 12 34 4 Q26 10 20 18Z" fill="#15803D" class="gt-leaf-mid-right"/>`
    : '';
  const sparkles = stages >= 2 ? `
    <circle cx="8" cy="6" r="1.5" fill="#FCD34D" class="gt-sparkle"/>
    <circle cx="32" cy="4" r="1" fill="#FCD34D" class="gt-sparkle" style="animation-delay:1.4s"/>
    <circle cx="36" cy="14" r="1.2" fill="#A3E635" class="gt-sparkle" style="animation-delay:1.5s"/>
  ` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 40 50" fill="none" role="img" aria-label="Growtenda logo">
  ${soilRect}
  <path d="M20 44 Q20 32 20 18" stroke="#4ADE80" stroke-width="2.5" stroke-linecap="round" class="gt-stem"/>
  ${leafLeftSmall}
  ${leafRightSmall}
  ${leafTop}
  ${leafMidLeft}
  ${leafMidRight}
  ${sparkles}
</svg>`;
}

function injectLogoStyles() {
  if (document.getElementById('growtenda-logo-styles')) return;
  const style = document.createElement('style');
  style.id = 'growtenda-logo-styles';
  style.textContent = LOGO_STYLES;
  document.head.appendChild(style);
}

function renderLogo(containerId, scale = 1) {
  injectLogoStyles();
  const el = document.getElementById(containerId);
  if (!el) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'gt-logo-root';
  wrapper.innerHTML = buildLogoSVG(scale);
  el.innerHTML = '';
  el.appendChild(wrapper);
}

export { renderLogo, buildLogoSVG };
