var planningVoorbeeldUrl = null;
var planningVoorbeeldUid = null;
var planningVoorbeeldVerzoek = null;
var planningVoorbeeldVersie = 0;

function verbergPlanningVoorbeeld() {
  document.getElementById('abonnement-achtergrond').hidden = true;
  document.body.classList.remove('abonnement-vergrendeld');
}

function resetPlanningVoorbeeld() {
  planningVoorbeeldVersie++;
  verbergPlanningVoorbeeld();
  if (planningVoorbeeldVerzoek) planningVoorbeeldVerzoek.abort();
  planningVoorbeeldVerzoek = null;
  if (planningVoorbeeldUrl) URL.revokeObjectURL(planningVoorbeeldUrl);
  planningVoorbeeldUrl = null; planningVoorbeeldUid = null;
  document.getElementById('abonnement-achtergrond-afbeelding').removeAttribute('src');
}

async function toonPlanningVoorbeeld() {
  if (!authProfiel || !auth.currentUser || !auth.currentUser.emailVerified) return;
  var background = document.getElementById('abonnement-achtergrond');
  background.hidden = false; document.body.classList.add('abonnement-vergrendeld');
  var uid = auth.currentUser.uid;
  if (planningVoorbeeldUid === uid && (planningVoorbeeldUrl || planningVoorbeeldVerzoek)) return;
  var version = ++planningVoorbeeldVersie, generation = authGeneratie;
  planningVoorbeeldUid = uid;
  var controller = new AbortController(); planningVoorbeeldVerzoek = controller;
  try {
    var response = await beveiligdeFetch('/api/schedule-preview', {method: 'POST', signal: controller.signal,
      headers: {'Content-Type': 'application/json'}, body: '{}'});
    if (!response.ok || !(response.headers.get('Content-Type') || '').startsWith('image/svg+xml')) return;
    var blob = await response.blob();
    if (version !== planningVoorbeeldVersie || generation !== authGeneratie || !auth.currentUser || auth.currentUser.uid !== uid) return;
    planningVoorbeeldUrl = URL.createObjectURL(blob);
    document.getElementById('abonnement-achtergrond-afbeelding').src = planningVoorbeeldUrl;
  } catch (_) {
    // The calendar outline remains visible; preview failures never change access.
  } finally {
    if (version === planningVoorbeeldVersie) planningVoorbeeldVerzoek = null;
  }
}
