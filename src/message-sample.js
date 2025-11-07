export const sampleDeal = {
  name: "Boat Smartwatch",
  price: 1299,
  discount: 56,
  image: "https://m.media-amazon.com/images/I/51Inwb0gwLL._AC_UL320_.jpg",
  link: "https://amzn.to/3LAnFaJ"
};

export const createMessage = (p, tag) => {
  return `🔥 *${p.name}* – ₹${p.price} (${p.discount}% OFF)
Bas kuch ghante bache bhai 😱
Abhi grab karo warna regret hoga 💥
👉 ${p.link}?tag=${tag}`;
};