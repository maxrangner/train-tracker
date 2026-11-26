// The page's options after # in its address (#replay=, #files=, #debug=...), read once.
export const hashParams = (hash = location.hash) => new URLSearchParams(hash.slice(1));
