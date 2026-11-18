/** Mode terang / gelap (owner 2026-11-17): kunci penyimpanan per browser dan skrip yang memasang kelas `.dark` di <html> sebelum halaman
 *  digambar (dipakai app/layout.tsx), supaya tidak berkedip putih. Tombolnya: components/shell/theme-toggle.tsx. */
export const THEME_KEY = "erp-theme";
export const THEME_BOOT_SCRIPT = `try{if(!location.pathname.startsWith("/vendor-maklon")&&localStorage.getItem("${THEME_KEY}")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;
