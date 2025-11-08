// message-sample.js
export const sampleDeal = {
  name: "🔥 Boat Smartwatch – Super Offer!",
  price: 1299,
  discount: 56,
  image: "https://m.media-amazon.com/images/I/51Inwb0gwLL._AC_UL320_.jpg",
  link: "https://amzn.to/3LAnFaJ",
};

/**
 * Builds a FOMO-style caption for WhatsApp
 * Automatically includes emoji, urgency & clickable link
 */
export function createMessage(deal, affiliateId = "") {
  const { name, price, discount, link } = deal;

  return `
💥 *${name}* 💥

🔥 Price Drop Alert!  
💰 *Now only ₹${price}* (Save ${discount}%)

🎯 _Limited Time Offer!_  
🛍️ Click here to grab the deal:  
👉 ${link}

${affiliateId ? `🔖 Tag: #${affiliateId}` : ""}
🚀 Hurry up! Before it’s gone! ⏰
  `.trim();
}
