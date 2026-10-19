const https = require('https');

function anthropicRequest(body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error: ' + data.substring(0,300))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

exports.handler = async function(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { datum, vestiging, vrijVoor, vrijNa, filmNaam } = JSON.parse(event.body);

    // Datum parsen zonder tijdzone issues: splits op '-'
    const parts = datum.split('-');
    const jaar = parseInt(parts[0]);
    const maandNr = parseInt(parts[1]) - 1;
    const dag = parseInt(parts[2]);

    const maanden = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
    const dagNamen = ['zondag','maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag'];
    const d = new Date(jaar, maandNr, dag);
    const dagNaam = dagNamen[d.getDay()];
    const datumLeesbaar = `${dag} ${maanden[maandNr]} ${jaar}`;

    const prompt = `Zoek op pathe.nl de actuele filmtijden voor ${dagNaam} ${datumLeesbaar}.
Bioscoop/locatie: ${vestiging || 'alle Pathé bioscopen in Nederland'}.
${filmNaam ? `Zoek specifiek naar de film: "${filmNaam}".` : ''}

Mijn vrije tijdsloten op ${datumLeesbaar}:
${vrijVoor ? `- VOOR mijn boekingen beschikbaar: ${vrijVoor}` : ''}
- NA mijn boekingen beschikbaar: ${vrijNa}

Zoek welke films op pathe.nl draaien op ${datumLeesbaar} en geef de tijden die binnen mijn vrije slots vallen.
Een film past als de starttijd binnen het vrije slot valt.

Geef antwoord UITSLUITEND als JSON array, geen uitleg, geen backticks:
[{"titel":"Filmnaam","duur":"2u 10m","genre":"Actie","vestiging":"Pathé Utrecht Leidsche Rijn","tijden":["19:15","21:30"],"slot":"na","pathe_url":"https://www.pathe.nl/films/..."}]

slot = "voor" als film past VOOR mijn boekingen, "na" als film past NA mijn boekingen.
Geen resultaten? Geef [].`;

    console.log('Zoeken:', datumLeesbaar, '|', vestiging, '| voor:', vrijVoor, '| na:', vrijNa, '| film:', filmNaam);

    const data = await anthropicRequest({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    });

    if (data.error) {
      if (data.error.type === 'rate_limit_error') {
        return { statusCode: 429, headers, body: JSON.stringify({ error: 'Te veel verzoeken tegelijk. Wacht 10 seconden en probeer opnieuw.', films: [] }) };
      }
      throw new Error(data.error.message);
    }

    let tekst = '';
    if (data.content) {
      data.content.forEach(block => {
        if (block.type === 'text') tekst += block.text;
      });
    }

    console.log('AI response:', tekst.substring(0, 600));

    tekst = tekst.trim().replace(/```json|```/g, '').trim();
    const match = tekst.match(/\[[\s\S]*\]/);
    let films = [];
    if (match) {
      try { films = JSON.parse(match[0]); } catch(e) { console.log('JSON parse fout:', e.message); }
    }

    console.log('Films gevonden:', films.length);
    return { statusCode: 200, headers, body: JSON.stringify({ films }) };

  } catch (err) {
    console.error('Function error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message, films: [] }) };
  }
};
