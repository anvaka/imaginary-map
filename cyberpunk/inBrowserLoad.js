const countries = countries = [
  {"country": "Afghanistan", "figure": "Ahmad Shah Durrani"},
  {"country": "Angola", "figure": "Agostinho Neto"}
]

function getAllQueries() {
  const allQueries = [];
  for (let i = 0; i < countries.length; i++) {
    const country = countries[i];
    const prompt = `"${country.figure} in cyberpunk settings. ${country.country}"`
    allQueries.push(`${prompt}`);
  }
  return allQueries;
}

queries = getAllQueries()
  async function getAllIds() { 
      let ids = [];
  let page = 1;

  while (true) {
    const url = `TODO://add url here/?new&page=${page}`;
    const response = await fetch(url, {"mode": "cors","credentials": "include"});

    if (response.status !== 200) {
      console.log('Error:', response.status);
      break;
    }

    const data = await response.json();
    if (data.length === 0) {
      break; // No more pages
    }
    let found = false;
    for (const record of data) {
      if (queries.includes(record.full_command)) {
        ids.push({id: record.id, query: record.full_command});
        found = true;
      }
    }
    if (!found) {
      break; // No more matching records
    }

    page++;
  }

  return ids;
}
