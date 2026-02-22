/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          indigo:  "#6366f1",
          purple:  "#a855f7",
          emerald: "#10b981",
        },
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
  // Safelist dynamic color classes used in ReputationCard
  safelist: [
    "from-gray-600", "to-gray-500", "border-gray-700",
    "from-blue-600",  "to-blue-400",  "border-blue-700",
    "from-purple-600","to-purple-400","border-purple-700",
    "from-yellow-600","to-yellow-400","border-yellow-600",
    "from-indigo-500","via-purple-500","to-emerald-500","border-indigo-500",
    "bg-red-900/20","border-red-500","text-red-400",
    "bg-orange-900/20","border-orange-500","text-orange-400",
    "bg-yellow-900/20","border-yellow-500","text-yellow-400",
    "bg-green-900/20","border-green-500","text-green-400",
  ],
};