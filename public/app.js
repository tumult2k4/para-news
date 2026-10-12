// Pages are rendered on the server; this script only adds conveniences on top.

const THEME_KEY = 'paranews-theme';

document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try {
    localStorage.setItem(THEME_KEY, root.dataset.theme);
  } catch {}
});

// The edition picker holds each edition's URL.
document.getElementById('edition-select')?.addEventListener('change', (e) => {
  location.href = e.target.value;
});

// Archive filters: dropdowns apply at once, and empty fields stay out of the URL.
const filters = document.querySelector('form.filters');
if (filters) {
  filters.querySelectorAll('select').forEach((select) => select.addEventListener('change', () => filters.requestSubmit()));
  filters.addEventListener('submit', () => {
    for (const field of filters.elements) {
      if (field.name && (!field.value || (field.name === 'sort' && field.value === 'newest'))) field.disabled = true;
    }
  });
}
