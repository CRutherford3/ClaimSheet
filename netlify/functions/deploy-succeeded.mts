// Runs automatically after every successful Netlify deploy.
// Tells Bing (and other IndexNow search engines) the site changed so it recrawls fast.
const KEY = "e00c369f57e41915c1a0352a92f056ef";
const URLS = ["https://claimsheet.io/", "https://claimsheet.io/claim-tips/", "https://claimsheet.io/app/", "https://claimsheet.io/contact/", "https://claimsheet.io/privacy/", "https://claimsheet.io/terms/", "https://claimsheet.io/refunds/"];

export const handler = async () => {
  try {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: "claimsheet.io",
        key: KEY,
        keyLocation: `https://claimsheet.io/${KEY}.txt`,
        urlList: URLS,
      }),
    });
    console.log("IndexNow ping:", res.status);
  } catch (e) {
    console.log("IndexNow ping failed:", e);
  }
  return { statusCode: 200 };
};
