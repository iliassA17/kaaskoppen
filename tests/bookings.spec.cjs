const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  page.testErrors = [];
  page.on('pageerror', error => page.testErrors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(page.testErrors).toEqual([]);
});

// All remote requests are blocked. These tests never read or write live accounts.
async function openApp(page, path = '/app/') {
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

test('installatie-uitleg werkt vanuit het menu en inlogscherm met optionele browserinstallatie', async ({page}) => {
  await openApp(page);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#hamburger-btn').click();
  await page.locator('#menu-installeren').click();
  const dialog=page.getByRole('dialog',{name:'Je planning binnen één tik'});
  await expect(dialog).toBeVisible();
  await expect(page.locator('#menu-bar')).toBeHidden();
  await expect(dialog).toContainText('Android · Chrome');
  await expect(dialog).toContainText('iPhone · Safari');
  const androidTab=dialog.getByRole('tab',{name:'Android · Chrome'});
  const iphoneTab=dialog.getByRole('tab',{name:'iPhone · Safari'});
  await androidTab.click();
  await expect(page.locator('#install-android')).toBeVisible();
  await expect(page.locator('#install-iphone')).toBeHidden();
  const illustrations=page.locator('#install-android img');
  await expect(illustrations).toHaveCount(3);
  for(const image of await illustrations.all()){
    await image.scrollIntoViewIfNeeded();
    await expect.poll(()=>image.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  }
  await page.locator('#install-dialog').evaluate(el=>el.scrollTop=0);
  await iphoneTab.click();
  await expect(page.locator('#install-iphone')).toBeVisible();
  await expect(page.locator('#install-android')).toBeHidden();
  await expect(page.locator('#install-iphone img')).toHaveCount(3);
  for(const image of await page.locator('#install-iphone img').all()){
    await image.scrollIntoViewIfNeeded();
    await expect.poll(()=>image.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  }
  await iphoneTab.focus();await page.keyboard.press('ArrowLeft');
  await expect(androidTab).toHaveAttribute('aria-selected','true');
  await expect(androidTab).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#install-android')).toBeFocused();
  await page.getByRole('button',{name:'Uitleg sluiten'}).focus();
  await page.locator('#install-dialog').evaluate(el=>el.scrollTop=0);
  await expect(page.locator('#install-app-link')).toHaveAttribute('href','/app/');
  await expect(page.locator('#install-native')).toBeHidden();
  await page.screenshot({path:test.info().outputPath('installeren-mobiel.png'),fullPage:true});
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
  await page.evaluate(()=>{
    document.getElementById('app').style.display='none';
    document.getElementById('auth-overlay').style.display='flex';
    window.installPrompts=0;
    const event=new Event('beforeinstallprompt',{cancelable:true});
    event.prompt=async()=>{window.installPrompts++};
    window.dispatchEvent(event);
  });
  await page.locator('#auth-overlay [data-open-install]').click();
  await expect(dialog).toBeVisible();
  await page.locator('#install-native').click();
  expect(await page.evaluate(()=>window.installPrompts)).toBe(1);
  await expect(page.locator('#install-native')).toBeHidden();
  await page.getByRole('button',{name:'Uitleg sluiten'}).click();
  await expect(dialog).toBeHidden();
});

test('installatielink opent de uitleg en bewaart een schone app-link voor het beginscherm', async ({page}) => {
  await openApp(page,'/app/#installeren');
  await expect(page.locator('#install-dialog')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/app/');
  expect(new URL(page.url()).hash).toBe('');
  await page.getByRole('button',{name:'Uitleg sluiten'}).click();
  await page.locator('#hamburger-btn').click();
  await page.locator('#menu-intro').click();
  await expect(page.getByRole('heading',{level:1})).toContainText('Rust in je planning.');
});

test('de bestaande stijl met gekozen verbeteringen past op mobiel en blijft met toetsenbord bruikbaar', async ({ page }) => {
  await openApp(page);
  await page.setViewportSize({width: 1440, height: 1080});
  await page.evaluate(() => {
    const today = new Date();
    anker = today;
    boekingen = [0, 1, 2, 3].map((offset) => {
      const date = new Date(today); date.setDate(date.getDate() + offset);
      return {datumStr: datumNaarStr(date), start: 600 + offset * 60, eind: 695 + offset * 60,
        naam: ['Sophie', 'Thomas', 'Emma', 'Milan'][offset], prijs: 10, tijdvak: 0, betaling: offset === 2 ? 'achteraf' : 'betaald'};
    });
    setView('week');
  });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('#schema-subtitle')).toHaveText('Rust in je planning. Ruimte voor je dag.');
  await page.evaluate(() => updateRulesCard());
  await expect(page.locator('#schema-subtitle')).toHaveText('Rust in je planning. Ruimte voor je dag.');
  expect(await page.evaluate(() => document.fonts.check('400 16px "DM Mono"'))).toBe(true);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(15, 14, 12)');
  await expect(page.locator('body')).toHaveCSS('font-family', /^"?DM Mono"?, monospace$/);
  await page.screenshot({path: test.info().outputPath('planning-desktop.png'), fullPage: true, animations: 'disabled'});
  await page.locator('#hamburger-btn').click();
  await expect(page.locator('#menu-schema')).toBeFocused();
  await expect(page.locator('#hamburger-btn')).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({path: test.info().outputPath('planning-menu.png'), fullPage: true, animations: 'disabled'});
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-bar')).toBeHidden();
  await expect(page.locator('#hamburger-btn')).toBeFocused();
  await page.locator('#meer-info-toggle').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#meer-info-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#prijs-input')).toBeVisible();
  await page.locator('#meer-info-toggle').click();
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({width, height: 900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const name = await page.locator('#naam').boundingBox(), date = await page.locator('#datum').boundingBox();
    const time = await page.locator('#starttijd').boundingBox();
    expect(date.y).toBeGreaterThan(name.y); expect(time.y).toBeGreaterThanOrEqual(date.y + date.height);
    await page.locator('#tab-maand').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const cells = await page.locator('.month-cell').evaluateAll(cells => cells.map(c => ({left:c.getBoundingClientRect().left,right:c.getBoundingClientRect().right})));
    expect(cells.every(cell => cell.left >= 0 && cell.right <= width)).toBe(true);
    if (width === 390) await page.screenshot({path:test.info().outputPath('maand-mobiel.png'),fullPage:true,animations:'disabled'});
    for (const selector of ['#naam','#datum','#starttijd']) {
      const input = await page.locator(selector).boundingBox(), card = await page.locator('#app>.form-card').boundingBox();
      expect(input.x).toBeGreaterThanOrEqual(card.x + 12);
      expect(input.x + input.width).toBeLessThanOrEqual(card.x + card.width - 12);
      expect(await page.locator(selector).evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    }
    await page.locator('#tab-week').click();
    if (width === 390) await page.screenshot({path: test.info().outputPath('planning-mobiel.png'), fullPage: true, animations: 'disabled'});
  }
  await page.setViewportSize({width: 1440, height: 1080});
  await page.evaluate(() => document.body.classList.add('licht-thema'));
  await page.screenshot({path: test.info().outputPath('planning-licht.png'), fullPage: true, animations: 'disabled'});
  await page.emulateMedia({reducedMotion: 'reduce'});
  expect(await page.locator('#app').evaluate(el => parseFloat(getComputedStyle(el).animationDuration))).toBeLessThan(.01);
  await page.evaluate(() => {
    document.body.classList.remove('licht-thema');
    document.getElementById('app').style.display = 'none';
    document.getElementById('auth-overlay').style.display = 'flex';
  });
  await page.screenshot({path: test.info().outputPath('inloggen-desktop.png'), fullPage: true, animations: 'disabled'});
  await page.setViewportSize({width: 390, height: 844});
  await expect(page.locator('#auth-btn')).toBeInViewport();
  await page.screenshot({path: test.info().outputPath('inloggen-mobiel.png'), fullPage: true, animations: 'disabled'});
});

test('screenshotherkenning wordt pas na upload geladen en daarna hergebruikt', async ({page}) => {
  const extras=[];
  page.on('request', request => { if (/tesseract|emailjs/.test(request.url())) extras.push(request.url()); });
  await openApp(page);
  expect(extras).toEqual([]);
  let requests=0;
  await page.route('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js', route => {
    requests++;
    return route.fulfill({contentType:'application/javascript',body:'window.Tesseract={recognize:async()=>({data:{text:"23/10/2026 10:00"}})};'});
  });
  await page.locator('#scan-btn').click();
  const file={name:'boeking.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aUuoAAAAASUVORK5CYII=','base64')};
  await page.locator('#scan-input').setInputFiles(file);
  await expect(page.locator('#scan-resultaat')).toBeVisible();
  expect(requests).toBe(1);
  await page.evaluate(() => resetScan());
  await page.locator('#scan-input').setInputFiles({...file,name:'nog-een.png'});
  await expect(page.locator('#scan-resultaat')).toBeVisible();
  expect(requests).toBe(1);
});

for (const path of ['/app/', '/boekingen.html']) {
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

test('een tijdvakaantal kan met het toetsenbord worden vervangen en ongeldig invoeren wordt niet opgeslagen', async ({page}) => {
  await openApp(page); await page.evaluate(() => openInstellingen());
  const aantal = page.locator('#inst-max-tijdvakken');
  await page.locator('#inst-tijdvak-naam-0').fill('Mijn tijdvak');
  for (const n of [2,3,4,1]) {
    await aantal.focus(); await aantal.press('ControlOrMeta+A'); await aantal.press('Backspace');
    await expect(aantal).toHaveValue('');
    await aantal.press(String(n));
    await expect(aantal).toHaveValue(String(n));
    await expect(page.locator('#inst-tijdvak-namen input')).toHaveCount(n);
    await expect(page.locator('#inst-tijdvak-naam-0')).toHaveValue('Mijn tijdvak');
  }
  for (const value of ['5','12','0','2.5','']) {
    await aantal.fill(value);
    await page.getByRole('button',{name:'Opslaan tijdvakken'}).click();
    await expect(page.locator('#inst-tijdvakken-error')).toBeVisible();
    await expect(aantal).toHaveAttribute('aria-invalid','true');
    if (Number(value)>4) await expect(page.locator('#inst-tijdvakken-error')).toContainText('maximaal 4');
    expect(await page.evaluate(() => testStore.instellingen.tester.maxTijdvakken)).toBeUndefined();
    expect(await page.evaluate(() => MAX_TIJDVAKKEN)).toBe(1);
  }
  await aantal.fill('2');
  await expect(page.locator('#inst-tijdvakken-error')).toBeHidden();
  await page.getByRole('button',{name:'Opslaan tijdvakken'}).click();
  await expect.poll(() => page.evaluate(() => testStore.instellingen.tester.maxTijdvakken)).toBe(2);
  await page.reload(); await page.evaluate(async () => { huidigeGebruiker='tester'; await laadInstellingen(); openInstellingen(); });
  await expect(aantal).toHaveValue('2');
  await expect(page.locator('#inst-tijdvak-namen input')).toHaveCount(2);
  await expect(page.locator('#inst-tijdvak-naam-0')).toHaveValue('Mijn tijdvak');
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
