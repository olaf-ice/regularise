const lat = 6.596;
const lng = 3.342;
const radius = 5000;
const query = `[out:json];(node["amenity"="hospital"](around:${radius},${lat},${lng});node["amenity"="clinic"](around:${radius},${lat},${lng});node["amenity"="police"](around:${radius},${lat},${lng}););out 10;`;
const url = 'https://overpass-api.de/api/interpreter';
console.log("Fetching url via POST urlencoded:", url);

fetch(url, {
  method: 'POST',
  headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
  },
  body: 'data=' + encodeURIComponent(query)
})
  .then(res => res.text())
  .then(text => {
      console.log("Response text length:", text.length);
      console.log("Response snippet:", text.substring(0, 200));
      try {
          const json = JSON.parse(text);
          console.log("Parsed elements:", json.elements ? json.elements.length : "undefined");
      } catch (e) {
          console.error("JSON Parse error:", e);
      }
  })
  .catch(err => {
      console.error("Fetch error:", err);
  });
