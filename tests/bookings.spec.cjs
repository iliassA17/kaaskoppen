const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  page.testErrors = [];
  page.on('pageerror', error => page.testErrors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(page.testErrors).toEqual([]);
});

// All remote requests are blocked. These tests never read or write live accounts.
async function openApp(page, path = '/') {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.addInitScript(() => {
    window.testStore = JSON.parse(sessionStorage.getItem('test-firestore')) ||
      { instellingen: { tester: { pushNieuws: false, meldingMinuten: 25 } } };
    window.testWrites = [];
    window.testFailSave = false;
    window.testSaveDelay = 0;
    function persist() {
      sessionStorage.setItem('test-firestore', JSON.stringify(window.testStore));
    }
    function collection(name, filters = []) {
      return {
        where(field, operator, value) { return collection(name, [...filters, [field, value]]); },
        async get() {
          const docs = Object.entries(window.testStore[name] || {})
            .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
            .map(([id, data]) => ({ id, data: () => ({ ...data }), ref: collection(name).doc(id) }));
          return { docs, empty: docs.length === 0 };
        },
        doc(id) {
          id = id || 'test-' + crypto.randomUUID();
          return {
            id,
            testCollection: name,
            testId: id,
            async get() {
              const data = window.testStore[name]?.[id];
              return { exists: !!data, data: () => data };
            },
            async set(data, options) {
              if (window.testFailSave) throw new Error('Test: offline');
              const store = window.testStore[name] ||= {};
              store[id] = options?.merge ? { ...store[id], ...data } : { ...data };
              persist();
            },
            async update(data) {
              if (!window.testStore[name]?.[id]) throw new Error('Document ontbreekt');
              return this.set(data, { merge: true });
            },
          };
        },
      };
    }
    window.firebase = {
      initializeApp() {},
      firestore: () => ({
        collection,
        batch() {
          const writes = [];
          const operations = [];
          return {
            delete(ref) { operations.push({ ref }); },
            set(ref, data) { writes.push({ ...data }); operations.push({ ref, data: { ...data } }); },
            async commit() {
              await new Promise(resolve => setTimeout(resolve, window.testSaveDelay));
              if (window.testFailSave) throw new Error('Test: offline');
              for (const { ref, data } of operations) {
                const store = window.testStore[ref.testCollection] ||= {};
                if (data) store[ref.testId] = data;
                else delete store[ref.testId];
              }
              persist();
              window.testWrites.push(writes);
            },
          };
        },
        async runTransaction(callback) {
          const batch = this.batch();
          const result = await callback({
            get: ref => ref.get(),
            set: (ref, data) => batch.set(ref, data),
            delete: ref => batch.delete(ref),
          });
          await batch.commit();
          return result;
        },
      }),
    };
    window.emailjs = { init() {}, send: async () => {} };
    window.firebase.auth = () => ({ onAuthStateChanged(callback) { callback(null); } });
    window.firebase.auth.Auth = { Persistence: { NONE: 'none', LOCAL: 'local', SESSION: 'session' } };
  });
  await page.goto(path);
  await page.evaluate(() => {
    huidigeGebruiker = 'tester';
    document.getElementById('auth-overlay').style.display = 'none';
    toonPagina('schema');
    document.getElementById('datum').value = '2026-11-02';
    document.getElementById('starttijd').value = '10:00';
    document.getElementById('naam').value = 'Testboeking';
  });
}

for (const path of ['/', '/boekingen.html']) {
  test.describe(path, () => {
    test.beforeEach(async ({ page }) => openApp(page, path));

    test('een gratis boeking blijft gratis bij toevoegen en bewerken', async ({ page }) => {
      await page.locator('#prijs-input').fill('0');
      await page.locator('#add-btn').click();
      await expect.poll(() => page.evaluate(() => testWrites.length)).toBe(1);
      expect(await page.evaluate(() => boekingen[0].prijs)).toBe(0);
      await page.evaluate(() => openBewerkModal('2026-11-02', 600, 0));
      await expect(page.locator('#bewerk-prijs')).toHaveValue('0');
      await page.locator('#bewerk-naam').fill('Gratis bijgewerkt');
      await page.locator('#bewerk-opslaan-btn').click();
      await expect.poll(() => page.evaluate(() => testWrites.length)).toBe(2);
      expect(await page.evaluate(() => boekingen[0].prijs)).toBe(0);
      await page.evaluate(() => {
        openStatistieken();
        statPeriode = 'dag';
        statAnker = strNaarDatum('2026-11-02');
        renderStatistieken();
      });
      await expect(page.locator('#stat-grid .stat-kaart').filter({ hasText: /^Boekingen/ }).locator('.stat-waarde')).toHaveText('1');
      await expect(page.locator('#stat-grid .stat-kaart').filter({ hasText: 'Ontvangen' }).locator('.stat-waarde')).toHaveText('€ 0.00');
    });

    test('een bestaande boeking van 10 euro wordt 0 euro en blijft dat na herladen', async ({ page }) => {
      await page.locator('#add-btn').click();
      await expect.poll(() => page.evaluate(() => testWrites.length)).toBe(1);
      expect(await page.evaluate(() => boekingen[0].prijs)).toBe(10);
      await page.evaluate(() => { anker = strNaarDatum('2026-11-02'); setView('dag'); });
      await page.locator('.edit-btn').first().click();
      await page.locator('#bewerk-prijs').fill('0');
      await page.locator('#bewerk-naam').click();
      await expect(page.locator('#bewerk-prijs')).toHaveValue('0');
      await page.locator('#bewerk-opslaan-btn').click();
      await expect(page.locator('#bewerk-overlay')).toBeHidden();
      expect(await page.evaluate(() => boekingen[0].prijs)).toBe(0);
      expect(await page.evaluate(() => testWrites.at(-1)[0].prijs)).toBe(0);
      await page.reload();
      await page.evaluate(async () => { huidigeGebruiker = 'tester'; await laadBoekingen(); openBewerkModal('2026-11-02', 600, 0); });
      await expect(page.locator('#bewerk-prijs')).toHaveValue('0');
      expect(await page.evaluate(() => boekingen[0].prijs)).toBe(0);
    });

    test('algemene instellingen bewaren bestaande meldingsvoorkeuren', async ({ page }) => {
      await page.evaluate(() => slaInstellingenOp(95, 540, 1440, 10, 1, ['Tijdvak 1']));
      expect(await page.evaluate(() => testStore.instellingen.tester)).toMatchObject({
        pushNieuws: false, meldingMinuten: 25, minGap: 95,
      });
    });

    test('een late opslagfout herstelt geen boekingen achter het verlopen proefscherm', async ({ page }) => {
      await page.locator('#add-btn').click();
      await expect.poll(() => page.evaluate(() => testWrites.length)).toBe(1);
      await page.locator('#starttijd').fill('12:00');
      await page.evaluate(() => {
        testSaveDelay = 500; testFailSave = true;
        const original = slaOp;
        slaOp = function() { return original.apply(this, arguments).finally(() => { window.testSaveSettled = true; }); };
      });
      await page.locator('#add-btn').click();
      await expect.poll(() => page.evaluate(() => boekingOpslaanBezig)).toBe(true);
      await page.evaluate(() => toonAbonnementKeuze({allowed: false, kind: 'expired'}));
      await expect.poll(() => page.evaluate(() => window.testSaveSettled)).toBe(true);
      expect(await page.evaluate(() => boekingen)).toEqual([]);
      await expect(page.locator('#app')).toBeHidden();
      await expect(page.locator('#abonnement-overlay')).toBeVisible();
    });

    test('een boekingsnaam verschijnt als tekst in het logboek', async ({ page }) => {
      await page.locator('#naam').fill('<img src=x onerror="window.testInjection=true">');
      await page.locator('#add-btn').click();
      await expect.poll(() => page.evaluate(() => testWrites.length)).toBe(1);
      await expect(page.locator('#logboek img')).toHaveCount(0);
      expect(await page.evaluate(() => window.testInjection)).toBeUndefined();
    });

    test('oude platformgegevens worden als tekst weergegeven', async ({ page }) => {
      await page.evaluate(() => {
        boekingen = [{ datumStr: '2026-11-02', start: 600, eind: 695, naam: 'Test',
          platform: '<img src=x onerror="window.testInjection=true">', betaling: 'betaald', prijs: 0 }];
        anker = strNaarDatum('2026-11-02');
        setView('dag');
      });
      await expect(page.locator('.booking-dur')).toContainText('<img src=x');
      await expect(page.locator('.booking-item img')).toHaveCount(0);
      await page.evaluate(() => {
        openStatistieken();
        statPeriode = 'dag';
        statAnker = strNaarDatum('2026-11-02');
        renderStatistieken();
      });
      await expect(page.locator('.platform-naam')).toContainText('<img src=x');
      await expect(page.locator('#pagina-statistieken img')).toHaveCount(0);
      expect(await page.evaluate(() => window.testInjection)).toBeUndefined();
    });

    test('een mislukte toevoeging bewaart invoer en kan opnieuw worden geprobeerd', async ({ page }) => {
      await page.evaluate(() => { testFailSave = true; });
      await page.locator('#add-btn').click();
      await expect(page.locator('#logboek')).toContainText('Niet opgeslagen');
      expect(await page.evaluate(() => ({ bookings: boekingen, undo: undoStack }))).toEqual({ bookings: [], undo: [] });
      await expect(page.locator('#naam')).toHaveValue('Testboeking');
      await expect(page.locator('#add-btn')).toBeEnabled();
      await page.evaluate(() => { testFailSave = false; });
      await page.locator('#add-btn').click();
      await expect.poll(() => page.evaluate(() => testWrites.length)).toBe(1);
      expect(await page.evaluate(() => boekingen.length)).toBe(1);
    });

    test('snelle herhaalde acties worden tijdens opslag tegengehouden', async ({ page }) => {
      await page.evaluate(() => { testSaveDelay = 150; });
      await page.evaluate(() => { voegBoekingToe(); voegBoekingToe(); allesLeegmaken(); uitloggen(); });
      await expect.poll(() => page.evaluate(() => testWrites.length)).toBe(1);
      expect(await page.evaluate(() => ({ count: boekingen.length, user: huidigeGebruiker, undo: undoStack.length })))
        .toEqual({ count: 1, user: 'tester', undo: 1 });
    });

    for (const action of ['bewerken', 'verwijderen', 'betalen', 'wissen', 'ongedaan maken']) {
      test(`mislukt ${action} herstelt de boekingen en undo-geschiedenis`, async ({ page }) => {
        const before = await page.evaluate(() => {
          const booking = { datumStr: '2026-11-02', start: 600, eind: 695, naam: 'Bestaand', prijs: 0, betaling: 'achteraf', tijdvak: 0 };
          boekingen = [booking];
          undoStack = [JSON.stringify([])];
          anker = strNaarDatum(booking.datumStr);
          testFailSave = true;
          return { bookings: boekingen, undo: undoStack };
        });
        await page.evaluate(action => {
          if (action === 'bewerken') {
            openBewerkModal('2026-11-02', 600, 0);
            document.getElementById('bewerk-naam').value = 'Gewijzigd';
            slaBewerking();
          } else if (action === 'verwijderen') verwijderBoeking('2026-11-02', 600, 0);
          else if (action === 'betalen') markeerBetaald('2026-11-02', 600, 0);
          else if (action === 'wissen') allesLeegmaken();
          else ongedaanMaken();
        }, action);
        await expect(page.locator('#logboek')).toContainText('Niet opgeslagen');
        expect(await page.evaluate(() => ({ bookings: boekingen, undo: undoStack }))).toEqual(before);
        if (action === 'bewerken') {
          await expect(page.locator('#bewerk-overlay')).toBeVisible();
          await expect(page.locator('#bewerk-error')).toContainText('Niet opgeslagen');
        }
      });
    }

    test('toevoegen, betalen, verwijderen en ongedaan maken werken achter elkaar', async ({ page }) => {
      await page.evaluate(() => document.querySelector('[data-groep="betaling"][data-waarde="achteraf"]').click());
      await page.locator('#add-btn').click();
      await expect.poll(() => page.evaluate(() => testWrites.length)).toBe(1);
      await page.evaluate(() => markeerBetaald('2026-11-02', 600, 0));
      expect(await page.evaluate(() => boekingen[0].betaling)).toBe('betaald');
      await page.evaluate(() => verwijderBoeking('2026-11-02', 600, 0));
      expect(await page.evaluate(() => boekingen.length)).toBe(0);
      await page.evaluate(() => ongedaanMaken());
      expect(await page.evaluate(() => boekingen.length)).toBe(1);
      expect(await page.evaluate(() => testWrites.length)).toBe(4);
    });
  });
}

test('een aangeboden tijdvak wordt bij bevestiging opnieuw gecontroleerd', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    MAX_TIJDVAKKEN = 2;
    TIJDVAK_NAMEN = ['Een', 'Twee'];
    syncTijdvakFormSelect();
    boekingen = [{ datumStr: '2026-11-02', start: 600, eind: 695, naam: 'Bezet', tijdvak: 0 }];
  });
  await page.locator('#add-btn').click();
  await expect(page.locator('#tijdvak-conflict-panel')).toBeVisible();
  await page.evaluate(() => {
    boekingen.push({ datumStr: '2026-11-02', start: 600, eind: 695, naam: 'Ook bezet', tijdvak: 1 });
  });
  await page.locator('#tijdvak-conflict-panel button').first().click();
  expect(await page.evaluate(() => boekingen.length)).toBe(2);
  expect(await page.evaluate(() => testWrites.length)).toBe(0);
  await expect(page.locator('#logboek')).toContainText('bezet');
});

test('tijdvaknamen blijven bewaard tijdens aanpassen van het aantal', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => openInstellingen());
  await page.locator('#inst-tijdvak-naam-0').fill('Eigen naam');
  await page.locator('#inst-max-tijdvakken').fill('2');
  await expect(page.locator('#inst-tijdvak-naam-0')).toHaveValue('Eigen naam');
  // Unsaved settings cannot expose a new slot in the live booking form.
  await expect(page.locator('#tijdvak-select option')).toHaveCount(1);
  expect(await page.evaluate(() => MAX_TIJDVAKKEN)).toBe(1);
});

test('een eerste gedeeltelijke instellingenopslag houdt standaardtijden geldig', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    delete testStore.instellingen.tester;
    document.getElementById('inst-max-tijdvakken').value = '2';
    updateTijdvakNamenInputs();
    slaAlleenTijdvakkenOp();
  });
  await expect.poll(() => page.evaluate(() => testStore.instellingen.tester?.maxTijdvakken)).toBe(2);
  await page.evaluate(() => laadInstellingen());
  expect(await page.evaluate(() => ({ MIN_GAP, DUUR, OPEN, SLUIT, MAX_TIJDVAKKEN })))
    .toEqual({ MIN_GAP: 95, DUUR: 95, OPEN: 540, SLUIT: 1440, MAX_TIJDVAKKEN: 2 });
});

test('een bezet tijdvak kan niet door verlagen van het aantal verdwijnen', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    MAX_TIJDVAKKEN = 2;
    boekingen = [{ datumStr: '2026-11-02', start: 600, naam: 'Bestaand', tijdvak: 1 }];
    document.getElementById('inst-max-tijdvakken').value = '1';
  });
  const dialog = page.waitForEvent('dialog');
  const result = page.evaluate(() => slaAlleenTijdvakkenOp());
  const alert = await dialog;
  expect(alert.message()).toContain('Verplaats eerst');
  await alert.dismiss();
  await result;
  expect(await page.evaluate(() => MAX_TIJDVAKKEN)).toBe(2);
  expect(await page.evaluate(() => testStore.instellingen.tester.maxTijdvakken)).toBeUndefined();
});

test('een mislukte instellingenopslag verandert de actieve instellingen niet', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => {
    testFailSave = true;
    try { await slaInstellingenOp(30, 600, 1200, 0, 3, ['A', 'B', 'C']); } catch (_) {}
  });
  expect(await page.evaluate(() => ({ MIN_GAP, OPEN, SLUIT, STANDAARD_PRIJS, MAX_TIJDVAKKEN })))
    .toEqual({ MIN_GAP: 95, OPEN: 540, SLUIT: 1440, STANDAARD_PRIJS: 10, MAX_TIJDVAKKEN: 1 });
});

test('de opgeslagen standaardprijs 0 vult na herladen opnieuw het boekingsformulier', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => openInstellingen());
  await page.locator('#inst-prijs').fill('0');
  await page.locator('#inst-opslaan').click();
  await expect(page.locator('#prijs-input')).toHaveValue('0');
  expect(await page.evaluate(() => testStore.instellingen.tester.standaardPrijs)).toBe(0);
  await page.reload();
  await page.evaluate(async () => { huidigeGebruiker = 'tester'; await laadInstellingen(); });
  await expect(page.locator('#prijs-input')).toHaveValue('0');
});
