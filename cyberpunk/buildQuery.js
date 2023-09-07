let countries = require('./list.json');

module.exports = function getAllQueries() {
  const allQueries = [];
  for (let i = 0; i < countries.length; i++) {
    const country = countries[i];
    const prompt = `"${country.figure} in cyberpunk settings. ${country.country}"`
    allQueries.push(`${prompt}`);
  }
  return allQueries;
}

function printAllCommands() {
  const allQueries = getAllQueries();
  for (let i = 0; i < allQueries.length; i++) {
    const prompt = allQueries[i];
    console.log(`/imagine prompt:"${prompt}"`);
  }
}