/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./public/**/*.{html,js}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f5f3ff",
          100: "#ede9fe",
          500: "#7c3aed",
          600: "#6d28d9",
          700: "#5b21b6"
        }
      },
      boxShadow: {
        card: "0 8px 24px rgba(34, 39, 65, .06)"
      }
    }
  },
  plugins: [require("flowbite/plugin")]
};
