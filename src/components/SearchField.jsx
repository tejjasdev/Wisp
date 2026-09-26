import { SearchIcon } from './icons.jsx';

export const ROW_HEIGHT = 60;

/** Search box; ArrowDown moves focus into the list below it. */
export function SearchField({ value, onInput, placeholder, listRef }) {
  return (
    <label class="search">
      <SearchIcon />
      <input
        id="search"
        type="search"
        autoComplete="off"
        spellcheck={false}
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        onInput={(e) => onInput(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && listRef?.current) {
            e.preventDefault();
            listRef.current.focus();
          } else if (e.key === 'Escape' && value) {
            onInput('');
          }
        }}
      />
    </label>
  );
}
