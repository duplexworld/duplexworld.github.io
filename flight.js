/* ===========================================================================
   Duplex World - scroll-scrubbed camera flight, rendered live from stills.
   ---------------------------------------------------------------------------
   Same mechanic as the scroll-world skill: scroll drives a camera, not a
   slideshow. The difference is where the camera comes from. The skill
   pre-renders the flight as AI video and the page scrubs currentTime; here the
   flight is COMPUTED, every frame, as a transform over the supplied diorama.

   Why that is worth doing, beyond costing nothing:

     - Seams cannot pop. In the video pipeline a seam is two separately rendered
       clips that have to agree pixel for pixel, which is the single failure the
       skill spends the most words on. Here there are no clips, so there is no
       seam - one continuous function of scroll position.
     - Scrubbing backwards is exact, not a decoder seek.
     - The whole page is ~600 KB, so it still fits the single-file export the
       rest of this deck ships as.

   The trade is that the camera can only move within a flat image: it dollies and
   pans, it cannot orbit or open a roof. So the backdrop deliberately softens and
   dims as it pushes in, and the sharp object at each stop is that domain's own
   globe, at its native size.

   CONFIG - deliberately the scroll-world shape, so a rendered video chain can be
   dropped in later without rewriting the page:

     mountFlight(container, {
       hero: { src, w, h },
       sections: [{ id, label, still, clip?, eyebrow, title, body, tags[],
                    accent, scroll, linger, cam:{x,y,z}, cta?, note? }],
     })

   `cam` is in fractions of the hero image, so the numbers come straight off
   make_assets.py's measured label pills rather than being eyeballed. `clip` is
   read but unused today; when present a future build plays it instead of
   computing the transform.
   ========================================================================= */

function mountFlight(root, config) {
  let reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const S = config.sections || [];
  const N = S.length;
  /* `cam` is as load-bearing as `video.stops` and was the one unvalidated thing on the hot
     path. The endpoints of cameraAt spread it, and spreading undefined is legal, so a
     section missing its camera MOUNTS CLEANLY and then throws the first time the reader
     scrolls between two centres - inside a requestAnimationFrame callback, which never
     reschedules, so the flight freezes for the rest of the visit with one console line.
     Filling it in is better than failing: the page reads, and the warning says why. */
  const CAM0 = { x: 0.5, y: 0.5, z: 1.0 };
  S.forEach((s, i) => {
    const c = s.cam;
    if (c && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z)) return;
    console.warn('flight: section ' + i + ' (' + (s.id || s.label || '?')
      + ') has no usable cam; using the centre of the frame');
    s.cam = { ...CAM0, ...(c || {}) };
    ['x', 'y', 'z'].forEach((k) => { if (!Number.isFinite(s.cam[k])) s.cam[k] = CAM0[k]; });
  });
  const HERO = config.hero;
  const ASPECT = HERO.w / HERO.h;

  // Which BACKDROP a section wants on the left. Two of them, because a page about a paper
  // opens on the paper rather than on a camera move.
  //
  // A section's `mark` is a separate thing and composes with either: it is a name plate
  // over the backdrop, not a replacement for it. That distinction is the whole reason the
  // six world stops can keep flying - the film visits each world in turn and the plate says
  // which one you are looking at, where before the plate REPLACED the film and the flight
  // stopped dead for six stops.
  const STAGE_ROLES = ['logo', 'film', 'art', 'none'];
  const roleOf = (s) => (STAGE_ROLES.indexOf(s.stage) >= 0 ? s.stage
                         : (config.video ? 'film' : 'logo'));

  // ---------------------------------------------------------------- DOM
  const SHELL = config.shell || 'stacked';
  root.innerHTML = '';
  root.className = 'fw fw-shell-' + SHELL;

  // This page is committed to a single light world - the film is shot on a white studio
  // floor - and the walk renderer decides its own theme by reading this attribute at build
  // time. Set here rather than in the markup because the single-file export and the
  // artifact host both supply their own <html>, so an attribute written on the source tag
  // is silently dropped and every map comes up in the dark theme against a light page.
  document.documentElement.dataset.theme = 'light';
  // Art referenced from the markup rather than from this config - the topbar mark - still
  // has to be resolved through the export's table.
  document.querySelectorAll('img[data-art]').forEach((im) => {
    const [real, packed] = artSrc('art:' + im.dataset.art);
    if (packed) im.dataset.fallback = packed;
    if (real) im.src = real;
  });
  try {
    // The demo page at the site root writes this key, and the renderer prefers it over the
    // document. A reader who switched that page to dark would otherwise carry it here.
    if (localStorage.getItem('duplexworld-theme') === 'dark') {
      localStorage.setItem('duplexworld-theme', 'light');
    }
  } catch (e) { /* storage blocked; the attribute above still governs */ }

  const stage = el('div', 'fw-stage');
  const sky = el('div', 'fw-sky');
  const heroImg = artImg(null, null, 'fw-hero');
  // alt is assigned with src, never before it. An <img> with alt and no src is still an
  // image to assistive technology and Firefox paints the alt text across the stage, which
  // in the video path is a whole 38 MB download's worth of a sentence on screen.
  const HERO_ALT = 'The Duplex World diorama: the six worlds of an ordinary day, connected by paths';
  // Deferred when there is a film: this is 355 KB over the wire and 6.1 MB decoded, and in
  // the video path it is hidden the moment the first frame lands. Loading it anyway just
  // takes bandwidth from the film during the one window where the band is still empty.
  // Keyed off the VALIDATED config, not the raw one. `VID` is null both when there is no
  // video and when the config was rejected, and in the rejected case no <video> is ever
  // created - so the error handler that loads this backdrop could never fire and the left
  // half of the page stayed empty for the whole flight, with only a console warning.
  // Assigned below, once VID exists. `let` rather than a direct initialiser because the
  // value depends on the VALIDATED video config, which is built further down.
  let heroWanted;
  function setHeroSrc() {
    heroImg.alt = HERO_ALT;
    const [real, packed] = artSrc(HERO.src);
    heroImg.dataset.fallback = packed || real.replace(/\.webp$/i, '.png');
    heroImg.src = real;
  }
  function loadHero() {
    if (heroWanted) return;
    heroWanted = true;
    heroImg.hidden = false;
    setHeroSrc();
    heroImg.addEventListener('load', layout);
    // ...and put it in the document. The only other insertion site runs at mount time and
    // is gated on heroWanted, which is false whenever there is a valid film - so when the
    // film died this function un-hid and sourced an element that was never in the tree.
    // The left half of the page stayed empty for the whole flight, and the paint loop went
    // on writing styles to a detached node and reading a zero rect back off it.
    if (stage && !heroImg.parentNode) {
      const before = stage.querySelector('.fw-veil');
      stage.insertBefore(heroImg, before || null);
    }
  }

  // The rendered chain, when there is one. Scroll drives currentTime rather than a
  // transform, so the "camera" is whatever Seedance actually filmed. Everything else on
  // the page - bands, copy, rail - is unchanged, because it all keys off scroll position
  // and never cared how the backdrop was produced.
  // The guard checks the shape AND the values. A single non-finite entry makes timeAt
  // return NaN, drawVideo bails, and the film silently freezes on its last good frame while
  // the copy keeps painting - a failure with no console output and no visible cause. A
  // non-monotonic list is just as quiet: it plays one leg backwards.
  // `null` is now a legal entry and means "this section is not filmed". It is not the same
  // as zero: zero is the first frame and would drag the chain back to the top of the clip.
  function videoOK_config(v) {
    if (!v || typeof v.src !== 'string' || !Array.isArray(v.stops)) return 'video.src and video.stops are required';
    if (v.stops.length !== S.length) return 'video.stops needs exactly one entry per section';
    const filmed = v.stops.map((t, i) => [t, i]).filter(([t]) => t !== null && t !== undefined);
    if (filmed.length < 2) return 'video.stops needs at least two filmed sections; use null for the rest';
    if (!filmed.every(([t]) => Number.isFinite(t) && t >= 0)) return 'every non-null video.stops entry must be a finite, non-negative number';
    for (let k = 1; k < filmed.length; k++) {
      if (filmed[k][0] < filmed[k - 1][0]) return 'video.stops must not decrease; the leg from section ' + filmed[k - 1][1] + ' to ' + filmed[k][1] + ' would play backwards';
    }
    // A section that asks for the film but was never given a time would seek to NaN and
    // freeze the chain silently on whatever frame happened to be up.
    const orphan = S.findIndex((s, i) => roleOf(s) === 'film' &&
                                         (v.stops[i] === null || v.stops[i] === undefined));
    if (orphan >= 0) return 'section ' + orphan + ' has stage:"film" but no video.stops entry';
    return null;
  }
  const vidWhy = config.video ? videoOK_config(config.video) : 'no video configured';
  const VID = (config.video && !vidWhy) ? config.video : null;
  if (config.video && vidWhy) {
    console.warn('flight: ' + vidWhy + '; falling back to the computed camera');
  }
  // Now that VID is known. A rejected config leaves VID null and creates no <video>, so
  // the error handler that would otherwise load this backdrop can never fire - keyed off
  // the raw `config.video` instead, the left half of the page stayed empty for the whole
  // flight with nothing but a console warning to say why.
  // Read live, not once: a reader who turns the setting on mid-visit was previously
  // ignored until they reloaded.
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => {
      reduce = mq.matches;
      document.querySelectorAll('video.fw-art').forEach((v) => {
        if (reduce) { v.pause(); v.removeAttribute('autoplay'); } else { v.play().catch(() => {}); }
      });
      layout();
    };
    if (mq.addEventListener) mq.addEventListener('change', onMotion);
    else if (mq.addListener) mq.addListener(onMotion);
  }
  heroWanted = !VID;
  // With a film on the page the hero still is never shown, and an <img> carrying no src is
  // a broken image to the document: naturalWidth 0, which is what the export's own asset
  // check flags. Taken out of the tree rather than merely hidden.
  if (heroWanted) { setHeroSrc(); } else { heroImg.hidden = true; }
  let videoOK = false;
  let blobURL = null;
  /* WHICH film, and whether to fetch one at all.
     -----------------------------------------------------------------------------------
     The film is 38.9 MB and it was fetched whole on every page, which is 95-97% of every
     page load. Two things were wrong with that beyond the size:

       - a reader with prefers-reduced-motion paid all 38.9 MB for a video the page then
         deliberately never plays. That is the worst byte-per-pixel ratio on the site and
         it is charged to the reader least able to use it;
       - a phone on a slow connection paid the same as a desktop, for a stage that is at
         most 390 px wide there. Measured at 3 min 24 s on a 1.6 Mbps link.

     So: no film at all under reduced motion (the computed camera and the hero still are
     what that reader was going to see anyway), and the 7.4 MB 960x540 encode - same 104
     seconds, same shots - on a narrow viewport or a connection that says it is metered.
     A wide desktop, which is where this film is actually looked at, is unchanged. */
  function filmSrc() {
    const small = VID && VID.srcSmall;
    if (!small) return VID ? VID.src : null;
    const c = navigator.connection || {};
    /* The test used to be saveData, 2G, or a narrow viewport, which means every ordinary
       desktop took the 38.9 MB encode however slow its line was. The film is fetched WHOLE
       before the flight can begin, so that download is dead time on a page that looks
       static until it lands: measured against the deployed site, 3.1s at 100 Mbps, 12.5s
       at 25, and 31s at 10. The small encode is the same 104 seconds at 960x540 and 7.4 MB,
       so on anything short of a fast line it is the better picture - the one that is
       actually moving.
       `downlink` is Chrome's own estimate in Mbps and `effectiveType` its bucket; both are
       absent in Safari and Firefox.

       MEASURED, and as first written the test was inverted in BOTH directions:

         - Chrome CAPS `downlink` at 10 Mbps. It is a fingerprinting surface, so the spec
           has it round to the nearest 25 kbps and clamp there. `downlink < 12` is
           therefore true on every Chrome that has ever run this page, however fast the
           line, so Chrome always took the small encode and the test never did anything;
         - Safari and Firefox do not implement navigator.connection at all, so `c` is
           empty, every slow test reads false, and a desktop there took the 38.9 MB
           encode WHOLE before the flight could begin. Measured against this tree in
           WebKit at 1440px: flight.mp4, all 38.9 MB of it. That is 13s of a static page
           on a 25 Mbps line and 31s on a 10 Mbps one, and it is the likeliest thing
           behind a reader saying the page did not load.

       So the test now asks for POSITIVE evidence of a fast wide client before spending
       38.9 MB, rather than for evidence of a slow one before saving it. No evidence means
       the small encode, which is the safe direction: 960x540 against a stage that
       measures 557px on a 1440 desktop is already oversampled. */
    const fast = c.effectiveType === '4g'
      && typeof c.downlink === 'number' && c.downlink >= 9
      && c.saveData !== true;
    /* And only where 1080p is a picture anyone can SEE. The stage is about 49% of the
       viewport in the two-column shell, so its width in device pixels is what decides
       whether the 960px encode is being upscaled. Measured: 485px at 1280, 557 at 1440,
       941 at 1920, 1299 at 2560. So a 1440 laptop at DPR 1 is asking 557 device pixels of
       a 960px source and cannot possibly resolve 1920; the same laptop at DPR 2 is asking
       1114 and can. `min-width: 901px` alone was sending 38.9 MB to the first case. */
    const stagePx = Math.round(window.innerWidth * (window.devicePixelRatio || 1) * 0.49);
    return (fast && stagePx > 1000) ? VID.src : small;
  }
  /* Swapping a media element's src empties it, so for the two or three frames before the
     new source decodes the poster prints through - a flash of the opening shot in the
     middle of the flight. The frame that is up is copied to a canvas laid over the film
     first, and only taken away once the new source has decoded AND seeked back to where
     the reader was. From the outside nothing happens at all. */
  function upgradeToBlob(b) {
    if (!videoEl) return;
    const at = videoEl.currentTime;
    let shot = null;
    try {
      shot = document.createElement('canvas');
      shot.width = videoEl.videoWidth || 960;
      shot.height = videoEl.videoHeight || 540;
      shot.className = 'fw-video fw-video-shot';
      shot.setAttribute('aria-hidden', 'true');
      shot.getContext('2d').drawImage(videoEl, 0, 0, shot.width, shot.height);
      videoEl.parentNode.insertBefore(shot, videoEl.nextSibling);
    } catch (e) { shot = null; }
    const drop = () => { if (shot && shot.parentNode) shot.parentNode.removeChild(shot); shot = null; };
    blobURL = URL.createObjectURL(b);
    videoEl.addEventListener('loadeddata', function once() {
      videoEl.removeEventListener('loadeddata', once);
      try { videoEl.currentTime = at; } catch (e) {}
      requestAnimationFrame(() => requestAnimationFrame(drop));
    });
    // Whatever happens to the upgrade, the still does not outlive it.
    setTimeout(drop, 4000);
    videoEl.src = blobURL;
  }
  const videoEl = (VID && !reduce) ? document.createElement('video') : null;
  if (VID && reduce) {
    console.info('flight: reduced motion, so the film is not fetched');
    loadHero();
  }
  if (videoEl) {
    const VSRC = filmSrc();
    videoEl.className = 'fw-video';
    // Fetched whole and handed over as a Blob rather than pointed at the URL.
    //
    // This is what makes scrubbing BACKWARDS work. A streamed <video> is scrubbed by range
    // request: forward seeks ride the read-ahead the decoder already has, but once the file
    // has played out to the end the early ranges are evicted from the media cache, so every
    // backward seek goes to the network. Measured on this file that is the whole of the
    // "it does not come back the way it went" complaint - the maths was never wrong, the
    // bytes were simply not there any more. From a Blob every seek is memory in both
    // directions. serve.py's own comment records the same failure from the server side.
    //
    // The wait costs nothing visible: the computed camera flies the page until `loadeddata`
    // lands, which is the arrangement the page already had.
    // ...but NOT before the page works. Fetching it whole first made the film the last
    // thing to arrive instead of the first: `loadeddata` waited on all 7.4 MB, so the
    // largest-contentful-paint element on this page WAS the video and it landed at 7.6s on
    // ordinary 4G and 42s on a slow one. For that whole window the reader has a header and
    // a blank page, which is precisely the "it does not load" report.
    //
    // Streamed, the first frames decode in about a second, so the opening stops are live
    // almost at once. The Blob is then fetched in the background and swapped in when it
    // arrives, which restores backward scrubbing without anyone waiting for it.
    videoEl.src = VSRC;
    /* Only the small encode is pulled down whole. The Blob buys reliable BACKWARD seeking,
       and it costs the file's size in memory for the life of the document; at 7.4 MB that
       is a fair trade and at 38.9 MB it is not. The 38.9 MB encode also only ever goes to a
       client the test above found to be both wide and fast, which is exactly the client
       whose range requests come back quickly enough that a backward seek does not stall. */
    if (VID.srcSmall && VSRC === VID.srcSmall) {
      fetch(VSRC)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('HTTP ' + r.status))))
        .then(upgradeToBlob)
        .catch(() => {});   // the streamed source is already playing; nothing to fall back to
    }
    videoEl.muted = true;
    videoEl.defaultMuted = true;
    videoEl.playsInline = true;
    videoEl.preload = 'auto';
    if (VID.poster) videoEl.poster = artSrc(VID.poster)[0];
    videoEl.setAttribute('aria-hidden', 'true');
    // Never autoplay: this is a scrub surface, not a film. Playing it would fight
    // every currentTime write.
    videoEl.addEventListener('loadeddata', () => {
      videoOK = true;
      // Only now retire the computed-camera backdrop. If the video never decodes the
      // class never lands and the page keeps working exactly as it did before.
      root.classList.add('fw-has-video');
      onScroll();
    });
    videoEl.addEventListener('seeked', () => {
      seekBusy = false;
      // A new frame is up, so the last ground sample describes a frame nobody is looking at.
      // Without this the sampler is purely time-throttled, and the throttle loses a race it
      // is guaranteed to enter: the frame settles, the camera stops moving, the eased colour
      // has already reached the OLD sample so nothing reports movement, and the rAF chain
      // parks before the 90ms is up. Measured: stop 4 held stop 3's floor, rgb(229,230,229)
      // against a frame whose floor is rgb(252,250,250).
      groundDirty = true;
      if (seekQueued !== null) {
        const q = seekQueued;
        seekQueued = null;
        seekBusy = true;
        try { videoEl.currentTime = q; } catch (e) { seekBusy = false; }
      }
      // The follow loop may have parked itself while a seek was outstanding.
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; frame(false); });
    });
    videoEl.addEventListener('error', () => {
      videoOK = false;
      root.classList.remove('fw-has-video');
      // Retire the element outright. Leaving it displayed would keep a dead poster over the
      // fallback camera, and a seek that was in flight when the decoder died never fires
      // `seeked`, so the coalescing latch has to be released by hand or it deadlocks.
      root.classList.add('fw-video-dead');
      seekBusy = false;
      seekQueued = null;
      // The Blob is tens of megabytes and nothing will read it again. Without this the
      // browser holds it for the life of the document.
      if (blobURL) { URL.revokeObjectURL(blobURL); blobURL = null; }
      loadHero();         // only now is the fallback image actually needed
      frame(true);        // snap the camera into place rather than swooping to it
    });
  }

  const veil = el('div', 'fw-veil');
  // The copy has to stay readable over whatever happens to be under it, and what is
  // under it changes every frame. A scrim on the copy side is the only reliable fix:
  // text shadows alone lose against a white clinic wall.
  const scrim = el('div', 'fw-scrim');
  // The hero still is only in the tree when it is the thing being shown. With a film on
  // the page it never is, and an <img> with no src reports naturalWidth 0, which is a
  // broken image to any checker that walks document.images.
  stage.append(sky, veil, scrim);
  if (heroWanted) stage.insertBefore(heroImg, veil);
  if (videoEl) stage.insertBefore(videoEl, veil);

  // ------------------------------------------------------------ the other stage layers
  // The mark. It opens small above the title, then grows and takes the left half as the
  // page turns into two columns - which is why it is a stage layer and not an <img> inside
  // the copy: an image in the flow cannot travel out of the flow. Its whole geometry is one
  // scroll-driven number, --logo-t, so the shells can each decide where it lands.
  const LOGO = config.logo || {};
  const logoWrap = el('div', 'fw-logo');
  const logoImg = artImg(LOGO.src || HERO.src,
                         LOGO.alt || 'The Duplex World mark: the six worlds under one dome',
                         'fw-logo-img');
  logoWrap.appendChild(logoImg);
  logoWrap.hidden = true;
  stage.appendChild(logoWrap);

  // The world names, for the stops whose evidence is a table. A name and one line, because
  // six paragraphs about six worlds is the writeup this page is explicitly not doing.
  //
  // ONE LAYER PER SECTION, not one shared layer whose text is rewritten on arrival. Shared,
  // the six consecutive world stops kept the layer at full opacity the whole way through
  // (each stop's fade overlapped the next), so the only thing that ever changed was the
  // text, and it changed in a single frame at the midpoint between two stops. That is a cut
  // in the middle of a page whose entire premise is that it does not cut. Per section they
  // cross-fade on their own curves, exactly as the copy panels opposite them already do.
  // A per-section still, shown in the film's own box. The audio section has its own
  // artwork - the walker in headphones, pointing at the samples beside him - and it is a
  // picture rather than a frame of the flight, so it gets a layer instead of a stop time.
  const artImgs = S.map((sec) => {
    if (!sec.art) return null;
    // A clip is allowed here, not only a still. The audio section's art is the walker
    // turning to face the reader, which is a motion, and freezing the left half for one
    // stop in the middle of a page built on continuous movement reads as a fault.
    // Muted, inline and looping, so it is decoration rather than media: no controls, no
    // sound, and nothing for the reader to operate.
    if (/\.(mp4|webm)$/i.test(sec.art)) {
      const v = document.createElement('video');
      v.className = 'fw-art is-clip';
      v.muted = true; v.loop = true; v.playsInline = true;
      // Motion is motion, even when it is decoration: under prefers-reduced-motion the
      // clip holds its first frame instead of looping.
      v.autoplay = !reduce;
      v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
      v.setAttribute('aria-hidden', 'true');
      v.preload = 'auto';
      v.src = artSrc(sec.art)[0] || sec.art;
      v.hidden = true;
      stage.appendChild(v);
      return v;
    }
    const im = artImg(sec.art, sec.artAlt || '', 'fw-art');
    im.hidden = true;
    stage.appendChild(im);
    return im;
  });

  const marks = S.map((s) => {
    if (!s.mark) return null;
    const w = el('div', 'fw-mark');
    w.style.setProperty('--accent', s.accent || 'var(--pillar-agentic)');
    // Only when there is one. An <img> with no src is still an image to the document: it
    // reports naturalWidth 0, which is indistinguishable from art that failed to decode,
    // and it is what the alt-text-across-the-stage guard elsewhere in this file exists to
    // avoid. The world plates carry no globe - the film is already showing that world.
    const im = s.mark.src ? artImg(s.mark.src, '', 'fw-mark-globe') : null;
    const nm = el('div', 'fw-mark-name');
    nm.textContent = s.mark.name || '';
    const ln = el('div', 'fw-mark-line');
    ln.textContent = s.mark.line || '';
    if (im) w.appendChild(im);
    w.append(nm, ln);
    w.hidden = true;
    stage.appendChild(w);
    return w;
  });

  // One floating globe per section that has one. Kept in the DOM the whole time
  // and driven by opacity/transform, so nothing ever has to load mid-flight.
  const tiles = S.map((s) => {
    if (!s.still) return null;
    const im = new Image();
    im.src = s.still;
    im.alt = s.label + ' world globe';
    im.className = 'fw-tile';
    im.decoding = 'async';
    stage.appendChild(im);
    return im;
  });

  // Filled by the `maps` block below as the panels are built, and read by the lifecycle at
  // the bottom of this function. Declared here because a panel is built before the code that
  // manages it exists.
  const mapStops = [];
  const runStops = [];
  /* Declared up here beside runStops, not beside the tape renderer further down: the panel
     build runs long before that point, so a `const` at the renderer would be in its
     temporal dead zone the first time a section with tapes is built. */
  const MARK_INK = {
    'turn_take/smooth': 'var(--mk-smooth)',
    'turn_take/contested': 'var(--mk-contested)',
    'turn_take/failed': 'var(--mk-failed)',
    interruption: 'var(--mk-interrupt)',
    backchannel: 'var(--mk-back)',
    self_correction: 'var(--mk-self)',
  };
  // What each marker is called in words. The page is read by people who have not read the
  // appendix, and "turn_take/contested" is not a phrase anyone says out loud.
  const MARK_SAY = {
    'turn_take/smooth': 'clean handover',
    'turn_take/contested': 'both spoke at once',
    'turn_take/failed': 'handover failed',
    interruption: 'cut in',
    backchannel: 'mm-hm',
    self_correction: 'corrected itself',
  };
  const FX_SAY = {
    frame_drop: 'dropped frames',
    burst_noise: 'burst of noise',
    background_noise: 'background noise',
    out_of_turn_speech: 'a second voice',
    muffling: 'muffled',
    telephony: 'telephony band',
  };
  // Drawn on the tape, in the order a reader should notice them. Smooth handovers are
  // deliberately excluded: on a well-behaved call they are most of the marks and they
  // bury the three that matter.
  const MARK_SHOWN = ['turn_take/contested', 'turn_take/failed', 'interruption',
                      'self_correction'];
  const tapeStops = [];
  const tapeData = {};
  let tapesFetch = null;

  const copyWrap = el('div', 'fw-copy');
  // Scrolling swaps the live panel with no other signal, so announce it - but announce the
  // STOP, not the panel. A live region wrapped around all five articles turns one scroll to
  // the bottom into five queued readings of a title, two 60-word columns, six evidence cards
  // and a five-row table, and `polite` queues rather than interrupts, so the speech ends up
  // minutes behind the reader with no way to stop it.
  const status = el('div', 'fw-sr');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  /* One bad section must not take the page with it.
     -----------------------------------------------------------------------------------
     The build empties `root` up front and only appends the finished stage at the very
     end, so ANY throw in here - a `pillars` without `rows`, a `matrix` without `types`,
     a `ring` without `slices` - left <main> with zero children and a blank white screen.
     There was no console-visible cause beyond the stack, and the page looked like a
     server error rather than a config typo. Now the broken section degrades to a panel
     that names itself and says what failed, and the other twelve still read. */
  function buildPanel(s, i) {
    const p = el('article', 'fw-panel' + (s.layout === 'hero' ? ' fw-panel-hero' : ''));
    if (s.id) p.id = s.id;
    p.style.setProperty('--accent', s.accent || 'var(--pillar-agentic)');
    const eyebrow = el('div', 'fw-eyebrow');
    eyebrow.textContent = s.eyebrow || '';
    // A world stop's heading is its name plate, which lives on the other half of the
    // screen; without this, five results blocks shipped an empty <h2> and had no heading at
    // all in the accessibility tree.
    /* THE FIRST STOP'S TITLE IS THE PAGE'S H1.
       It used to be an h1 only on a hero-layout opening stop, which no page on this site
       actually has any more, so five of the eight shipped pages had no h1 at all - a
       document with no name, as far as an outline, a screen reader or a search engine is
       concerned. The title of the first stop IS the page's subject, whether or not it is
       drawn: several pages carry it as `fw-sr`, which is visually hidden and read aloud,
       and that is exactly the right thing for it to be. */
    const h = el(i === 0 ? 'h1' : 'h2', 'fw-title');
    // A section with no title and no world plate still needs a heading, or its h3s sit
    // under a blank h2. The eyebrow is the heading in those sections - it is what a
    // sighted reader reads as one - so it becomes the heading text and is hidden
    // visually to avoid printing it twice.
    h.textContent = s.title || (s.mark && s.mark.name) || s.eyebrow || s.label || '';
    if (!s.title && (s.mark && s.mark.name || s.eyebrow || s.label)) h.classList.add('fw-sr');
    const body = el('p', 'fw-body');
    body.textContent = s.body || '';
    p.append(eyebrow, h, body);
    if (!s.body) body.remove();
    /* A stop can carry the byline instead of a paragraph. The opening block is the usual
       home for authorship, but index.html has no opening - it goes straight into the
       flight - so the landing stop names the authors where its standfirst used to sit.
       Renders nothing in the anonymous build, because buildByline() returns null there. */
    if (s.byline) {
      const stopBy = buildByline();
      if (stopBy) { stopBy.classList.add('fw-body-by'); p.appendChild(stopBy); }
    }
    /* The corpus ring and the six globes, on a stop rather than in an opening cell. Same
       builders overview.html uses, so the two pages cannot draw different figures. */
    if (s.ring) {
      const rw = el('div', 'fw-stop-fig');
      rw.appendChild(buildRing(s.ring));
      p.appendChild(rw);
    }
    if (s.worlds) {
      const gw = el('div', 'fw-stop-fig');
      gw.appendChild(buildWorlds(s.worlds));
      p.appendChild(gw);
    }
    /* The three-by-three, as a STOP. The Experience page ends on it rather than handing the
       reader off to a page of its own, so the mark it closes on is the same mark the grid is
       built around. Same builder the opening uses. */
    if (s.cells) {
      const cw = el('div', 'fw-stop-cells');
      // A shim, NOT the stop itself: `mark` on a stop already means the world name plate
      // ({name, line}), and buildCells wants an image path. Passing the stop straight in
      // would have the grid read the plate object as a src.
      cw.appendChild(buildCells({ cells: s.cells, mark: s.cellsMark,
                                  markAlt: s.cellsMarkAlt }));
      p.appendChild(cw);
    }
    // The world plate is drawn on the stage, which on a phone is a picture with no room
    // beside it, so there the plate stands down and its two lines run in the panel where
    // the reader already is. The name is the heading that is only screen-reader hidden on
    // desktop; the regime line has nowhere else to live, so it gets a copy here.
    if (!s.body && s.mark && s.mark.line) {
      const ml = el('p', 'fw-body fw-phone-only');
      ml.textContent = s.mark.line;
      p.appendChild(ml);
    }

    /* THE ONWARD LINK. The pages are a sequence - experience, setup, samples, metrics,
       results, overview - and a reader who reaches the bottom of one should not have to go
       back up to the bar to find where the argument continues. One link, named, at the end
       of the page it follows from. Rendered as an anchor rather than a button so it is a
       real navigation the browser can open in a new tab and a screen reader announces as a
       link.
       "At the end of the page it follows from" is why it is HELD on a full-width band and
       appended last. A band's panel is the whole page - the samples page is one panel with
       twenty-six tiles in it - so appending here put "Next: how this was scored" above the
       first recording, which is the top of the page rather than the end of it. On every
       other kind of stop the panel is a paragraph and a figure, and the link belongs where
       it already was. */
    let nextCard = null;
    if (s.next && s.next.href) {
      const nx = el('a', 'fw-next');
      nx.href = s.next.href;
      const nk = el('span', 'fw-next-k');
      nk.textContent = s.next.kicker || 'Next';
      const nl = el('span', 'fw-next-l');
      nl.textContent = s.next.label || '';
      const na = el('span', 'fw-next-a');
      na.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13m-6-7 7 7'
        + '-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"'
        + ' stroke-linejoin="round"/></svg>';
      nx.append(nk, nl, na);
      if (s.next.note) {
        const nn = el('span', 'fw-next-n');
        nn.textContent = s.next.note;
        nx.appendChild(nn);
      }
      if (s.block === 'band') nextCard = nx;
      else p.appendChild(nx);
    }

    /* The opening summary: the abstract, and the three figures it is claiming.
       ---------------------------------------------------------------------------
       One screen that says what the work is AND shows the evidence for the one sentence
       that matters - "even the best voice agents leave substantial room for improvement on
       all 3 axes". Those three numbers are three different systems, so a reader who is only
       ever going to look at one screen should see all three plotted.

       The abstract is written as a list of runs rather than a string, because three of those
       runs are LINKED to a plot: hovering either one tints both. That is the whole reason
       the numbers are worth repeating in the prose - the prose says the claim, the plot
       shows the spread behind it, and the tint says they are the same fact.

       Deliberately no captions, no axis titles, no notes. The tile's own heading is the
       metric and the bars carry their values. */
    if (s.summary) {
      const SM = s.summary;
      const wrap = el('div', 'fw-sum');

      if (SM.abstract) {
        const ab = el('div', 'fw-sum-abstract');
        SM.abstract.forEach((run) => {
          if (typeof run === 'string') {
            ab.appendChild(document.createTextNode(run));
            return;
          }
          const sp = el('span', 'fw-lnk');
          sp.textContent = run.t;
          sp.dataset.link = run.link;
          sp.tabIndex = 0;
          ab.appendChild(sp);
        });
        wrap.appendChild(ab);
      }

      // Simple tiles: a heading and a few lines. They sit in the matrix beside the plots.
      const holeAfter = SM.holeAfter === undefined ? 2 : SM.holeAfter;
      // The mark sits IN the middle cell as its own image rather than being the stage film
      // showing through a hole. Flying the film from that cell out to the left column at the
      // next stop was a move nobody asked the page to make: the matrix should simply scroll
      // away, and the flight should begin where the flight begins.
      const mkHole = () => {
        const hole = el('div', 'fw-sum-hole');
        if (SM.mark) hole.appendChild(artImg(SM.mark, '', 'fw-sum-mark'));
        if (SM.centre) {
          const hl = el('span', '');
          hl.textContent = SM.centre;
          hole.appendChild(hl);
        }
        wrap.appendChild(hole);
      };
      (SM.tiles || []).forEach((T, ti) => {
        if (ti === holeAfter) mkHole();
        const t = el('figure', 'fw-tile-plot is-note');
        const h = el('figcaption', 'fw-tile-h');
        h.textContent = T.label;
        t.appendChild(h);
        if (T.big) {
          const b = el('div', 'fw-tile-big');
          b.textContent = T.big;
          t.appendChild(b);
        }
        if (T.worlds) {
          const g = el('div', 'fw-tile-worlds');
          T.worlds.forEach(([nm, src]) => {
            const w = el('div', 'fw-tw');
            w.appendChild(artImg(src, '', 'fw-tw-img'));
            const l = el('span', '');
            l.textContent = nm;
            w.appendChild(l);
            g.appendChild(w);
          });
          t.appendChild(g);
        }
        // A distribution strip: one row per conversation type, a line from the weakest
        // system to the strongest and a dot for each. Deliberately NOT a violin - a violin
        // needs a density, and five points per type is five points, not a density. This
        // shows the same thing a violin is asked to show, the spread within each type,
        // without inventing a curve the data cannot support.
        if (T.spread) {
          const sp = el('div', 'fw-spread');
          const top = T.spreadMax || 0.7;
          T.spread.forEach(([nm, vals]) => {
            const row = el('div', 'fw-sp-row');
            const l = el('span', 'fw-sp-n');
            l.textContent = nm;
            const track = el('div', 'fw-sp-t');
            const lo = Math.min(...vals), hi = Math.max(...vals);
            const rng = el('div', 'fw-sp-rng');
            rng.style.left = (100 * lo / top).toFixed(2) + '%';
            rng.style.width = (100 * (hi - lo) / top).toFixed(2) + '%';
            track.appendChild(rng);
            vals.forEach((v, k) => {
              const d = el('i', 'fw-sp-d');
              d.style.left = (100 * v / top).toFixed(2) + '%';
              d.style.setProperty('--i', String(k));
              d.title = v.toFixed(3);
              track.appendChild(d);
            });
            row.append(l, track);
            sp.appendChild(row);
          });
          t.appendChild(sp);
        }
        (T.items || []).forEach((it) => {
          const row = el('div', 'fw-tile-i');
          const k = el('b', '');
          k.textContent = it[0];
          const v = el('span', '');
          v.textContent = it[1] || '';
          row.append(k, v);
          t.appendChild(row);
        });
        if (T.chips) {
          const cw = el('div', 'fw-tile-chips');
          T.chips.forEach((c) => {
            const ch = el('span', 'fw-chip');
            ch.textContent = c;
            cw.appendChild(ch);
          });
          t.appendChild(cw);
        }
        wrap.appendChild(t);
      });
      if ((SM.tiles || []).length <= holeAfter) mkHole();

      const tiles = el('div', 'fw-sum-tiles');
      (SM.plots || []).forEach((P) => {
        const tile = el('figure', 'fw-tile-plot');
        tile.dataset.link = P.key;
        tile.tabIndex = 0;
        tile.style.setProperty('--tint', P.accent || 'var(--magenta)');
        const h = el('figcaption', 'fw-tile-h');
        h.textContent = P.label;
        tile.appendChild(h);

        // Sorted by its own value, because each of the three has a different leader and
        // that IS the finding. The reader should not have to scan for the tallest bar.
        const rows = (P.rows || []).slice().sort((a, b) => b[1] - a[1]);
        // The floor matters on DNSMOS: those five numbers live between 3.13 and 3.38, and
        // drawn from zero they are five identical columns. `base` says where the axis
        // starts, so the plot shows the spread that is actually there.
        const base = Number.isFinite(P.base) ? P.base : 0;
        const top = Number.isFinite(P.max) ? P.max : Math.max(...rows.map((r) => r[1]));
        const span = Math.max(1e-6, top - base);
        const dp = P.dp === undefined ? 3 : P.dp;

        // Plot and names are two grids on the same five tracks, not one grid of stacked
        // cells: the names are rotated, so they need a strip of their own to rake into
        // rather than a row that grows to fit whatever a rotated box reports.
        const cols = el('div', 'fw-cols');
        const names = el('div', 'fw-names');
        rows.forEach(([name, v]) => {
          const col = el('div', 'fw-col-b');
          const val = el('div', 'fw-col-v');
          val.textContent = v.toFixed(dp);
          const bar = el('div', 'fw-col-bar');
          bar.style.setProperty('--h',
            (100 * Math.max(0, Math.min(1, (v - base) / span))).toFixed(2) + '%');
          col.append(val, bar);
          cols.appendChild(col);

          const cell = el('div', 'fw-name-cell');
          const nm = el('div', 'fw-col-n');
          const mk = el('span', 'fw-col-mk');
          mk.innerHTML = vendorMark(name);
          const nt = el('span', '');
          nt.textContent = P.short && P.short[name] ? P.short[name] : name;
          nm.append(mk, nt);
          cell.appendChild(nm);
          names.appendChild(cell);
        });
        tile.append(cols, names);
        tiles.appendChild(tile);
      });
      // The plots go straight into the matrix rather than into a row of their own.
      while (tiles.firstChild) wrap.appendChild(tiles.firstChild);
      p.appendChild(wrap);

      // Hover and focus in EITHER direction. Held on the panel rather than on each element
      // so the two sides cannot get out of step, and so a pointer that leaves the abstract
      // for the plot it just lit does not flicker on the way.
      const lit = (key, on) => {
        p.querySelectorAll('[data-link="' + key + '"]').forEach((n) => {
          n.classList.toggle('is-lit', on);
        });
      };
      p.querySelectorAll('[data-link]').forEach((n) => {
        const k = n.dataset.link;
        n.addEventListener('mouseenter', () => lit(k, true));
        n.addEventListener('mouseleave', () => lit(k, false));
        n.addEventListener('focus', () => lit(k, true));
        n.addEventListener('blur', () => lit(k, false));
      });
    }

    /* A grouped bar chart: one cluster per conversation type, five systems in each.
       The point it exists to make is that Pass@1 is not a property of a system alone - the
       same five systems reorder across the types - and that only reads if the clusters sit
       on one axis. */
    (Array.isArray(s.grouped) ? s.grouped : s.grouped ? [s.grouped] : []).forEach((G) => {
      const fig = el('figure', 'fw-grp');
      if (G.label) {
        const cap = el('figcaption', 'fw-grp-label');
        cap.textContent = G.label;
        fig.appendChild(cap);
      }
      const top = Number.isFinite(G.max) ? G.max
        : Math.max(...G.groups.flatMap((g) => g.v));
      const plot = el('div', 'fw-grp-plot');
      G.groups.forEach((g) => {
        const cl = el('div', 'fw-grp-cluster');
        const bars = el('div', 'fw-grp-bars');
        g.v.forEach((v, k) => {
          const b = el('div', 'fw-grp-bar');
          b.style.setProperty('--h', (100 * Math.max(0, v) / top).toFixed(2) + '%');
          b.style.setProperty('--i', String(k));
          b.title = (G.systems[k] || '') + ' - ' + g.name + ' - ' + v.toFixed(3);
          bars.appendChild(b);
        });
        const nm = el('div', 'fw-grp-name');
        nm.textContent = g.name;
        cl.append(bars, nm);
        plot.appendChild(cl);
      });
      fig.appendChild(plot);
      const key = el('div', 'fw-grp-key');
      (G.systems || []).forEach((sys, k) => {
        const it = el('span', 'fw-grp-keyit');
        const sw = el('i', 'fw-grp-sw');
        sw.style.setProperty('--i', String(k));
        const tx = el('span', '');
        tx.textContent = sys;
        it.append(sw, tx);
        key.appendChild(it);
      });
      fig.appendChild(key);
      p.appendChild(fig);
    });

    /* A worked example.
       ---------------------------------------------------------------------------
       Five runs of one Pathfinding scenario, and the three numbers they produce. The
       metrics stop was a list of definitions, which is what the paper's glossary already
       is; what a reader needs is to watch GS, Pass@1 and Pass-cubed fall out of the same
       five runs, and to see why they are three different questions rather than three
       spellings of one.

       Every number here is derived from the runs beside it, in the page, so the arithmetic
       cannot drift from the illustration. */
    /* THE HARNESS. Who is actually talking to whom.
       Nobody picks up the phone: the caller is three models working together and the agent
       is a commercial speech-to-speech system, both on one 200 millisecond clock. A reader
       who does not know that reads every number on the later pages as a person talking to a
       bot, which is not what was run. The animated version of this diagram is a page of its
       own; this is the same fact, stated where the reader first needs it. */
    if (s.harness) {
      const HN = s.harness;
      const fig = el('figure', 'fw-hn');
      const cols = el('div', 'fw-hn-cols');

      const side = (head, sub, items, cls) => {
        const c = el('div', 'fw-hn-side ' + cls);
        const h = el('div', 'fw-hn-head');
        const hs = el('span', 'fw-hn-head-k');
        hs.textContent = head;
        const ht = el('span', 'fw-hn-head-t');
        ht.textContent = sub;
        h.append(hs, ht);
        c.appendChild(h);
        items.forEach((it) => {
          const b = el('div', 'fw-hn-box');
          const nm = el('div', 'fw-hn-role');
          nm.textContent = it.role;
          /* The model's own vendor mark beside its name. Both columns of this figure are
             lists of models, and the whole page identifies a system by its logo everywhere
             else - the tables, the tiles, the bars - so the one figure that actually names
             the stack was the only place a reader had to go on the string alone.
             vendorMark falls back to a neutral dot for a vendor with no mark shipped, so an
             unknown model degrades to what it already looked like rather than breaking. */
          const md = el('div', 'fw-hn-model');
          const mk = el('span', 'fw-hn-mark');
          mk.innerHTML = vendorMark(it.model);
          const mt = el('span', '');
          mt.textContent = it.model;
          md.append(mk, mt);
          b.append(nm, md);
          if (it.says) {
            const sy = el('p', 'fw-hn-says');
            sy.textContent = it.says;
            b.appendChild(sy);
          }
          c.appendChild(b);
        });
        return c;
      };

      cols.appendChild(side('The caller', HN.callerNote || 'simulated', HN.caller || [],
        'is-caller'));

      // The middle column is the point of the figure: both sides hold the channel at the
      // same time, and the tick is the clock they share.
      const mid = el('div', 'fw-hn-mid');
      const lane = (who, cls) => {
        const l = el('div', 'fw-hn-lane ' + cls);
        const n = el('span', 'fw-hn-lane-n');
        n.textContent = who;
        const t = el('span', 'fw-hn-lane-t');
        l.append(n, t);
        return l;
      };
      const midHead = el('div', 'fw-hn-mid-h');
      midHead.textContent = HN.midHead || 'both at once';
      mid.append(midHead, lane('caller', 'is-c'), lane('agent', 'is-a'));
      const tick = el('div', 'fw-hn-tick');
      tick.textContent = HN.tick || '200 ms ticks';
      mid.appendChild(tick);
      if (HN.midNote) {
        const mn = el('p', 'fw-hn-mid-n');
        mn.textContent = HN.midNote;
        mid.appendChild(mn);
      }
      cols.appendChild(mid);

      const ag = el('div', 'fw-hn-side is-agent');
      const ah = el('div', 'fw-hn-head');
      const ahk = el('span', 'fw-hn-head-k');
      ahk.textContent = 'The agent';
      const aht = el('span', 'fw-hn-head-t');
      aht.textContent = HN.agentNote || 'under test';
      ah.append(ahk, aht);
      ag.appendChild(ah);
      const abox = el('div', 'fw-hn-box is-tall');
      const ar = el('div', 'fw-hn-role');
      ar.textContent = HN.agentRole || 'Hears audio, answers in audio';
      abox.appendChild(ar);
      if (HN.agentSays) {
        const as = el('p', 'fw-hn-says');
        as.textContent = HN.agentSays;
        abox.appendChild(as);
      }
      (HN.systems || []).forEach((nm, k) => {
        const row = el('div', 'fw-hn-sys' + (k === 0 ? ' is-lead' : ''));
        const mk = el('span', 'fw-hn-mark');
        mk.innerHTML = vendorMark(nm);
        const t = el('span', '');
        t.textContent = nm;
        // The system's own colour on its own name, the same mapping the bars and the
        // tables use, so the five read as the same five throughout.
        t.style.color = sysTextColor(nm);
        row.append(mk, t);
        abox.appendChild(row);
      });
      ag.appendChild(abox);
      cols.appendChild(ag);
      fig.appendChild(cols);

      fig.setAttribute('role', 'img');
      fig.setAttribute('aria-label', 'The harness. The caller is simulated: '
        + (HN.caller || []).map((c) => c.role + ' with ' + c.model).join(', ')
        + '. The agent under test is one of ' + (HN.systems || []).length
        + ' commercial speech-to-speech systems: ' + (HN.systems || []).join(', ')
        + '. Both hold the channel at once, on a ' + (HN.tick || '200 ms') + ' clock.');

      if (HN.more && HN.more.href) {
        const a = el('a', 'fw-hn-more');
        a.href = HN.more.href;
        a.textContent = HN.more.label || 'See it run';
        fig.appendChild(a);
      }
      p.appendChild(fig);
    }

    /* ONE REAL EXCHANGE, drawn from a shipped recording.
       ---------------------------------------------------------------------------------
       The harness diagram says the caller and the agent hold the channel at once, and then
       the page moves on. It is the claim the whole benchmark rests on and it was the one
       thing on the page with nothing behind it - a reader is asked to take "both are
       speaking" on trust, three paragraphs before any audio.
       So: the opening seconds of an actual scored call, fetched from the same payload the
       samples page plays, drawn as the two lanes it is. Nothing is typed here. The lines,
       the times and the size of the overlap are read out of the file, so this cannot drift
       from the recording and cannot be prettier than the recording is. */
    if (s.example && s.example.call) {
      const EX = s.example;
      const fig = el('figure', 'fw-ex');
      const lede = el('figcaption', 'fw-ex-lede');
      lede.textContent = EX.lede || 'The first seconds of one scored call.';
      fig.appendChild(lede);
      const body = el('div', 'fw-ex-body');
      body.textContent = 'loading one call';
      fig.appendChild(body);
      p.appendChild(fig);

      /* `config.calls`, not the CALLS const. CALLS is declared two thousand lines below this
         one and the panels are built before that line runs, so reading it here is a
         temporal dead zone reference - which the per-section catch turns into "this section
         did not render" and nothing else. Same object, read from the config directly. */
      const base = ((config.calls || {}).base) || '../';
      fetch(base + EX.call + '.json')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
        .then((d) => {
          const all = (d.utterances || []).filter((u) => typeof u.s === 'number');
          const span = EX.seconds || 90;
          const us = all.filter((u) => u.s < span);
          if (us.length < 2) throw new Error('too few turns');
          body.textContent = '';

          // The two lanes, on one shared clock, drawn to scale.
          const lanes = el('div', 'fw-ex-lanes');
          [['agent', 'Agent'], ['user', 'Caller']].forEach(([who, label]) => {
            const row = el('div', 'fw-ex-lane');
            const lk = el('span', 'fw-ex-lane-k');
            lk.textContent = label;
            row.appendChild(lk);
            const track = el('div', 'fw-ex-track');
            us.filter((u) => u.who === who).forEach((u) => {
              const b = el('span', 'fw-ex-bar is-' + who);
              b.style.left = (100 * u.s / span).toFixed(2) + '%';
              b.style.width = (100 * Math.max(0.4, Math.min(span, u.e) - u.s) / span).toFixed(2) + '%';
              b.title = label + ', ' + u.s.toFixed(1) + 's to ' + u.e.toFixed(1) + 's';
              track.appendChild(b);
            });
            row.appendChild(track);
            lanes.appendChild(row);
          });

          /* THE OVERLAPS, measured rather than asserted. Every pair of turns where one
             speaker begins before the other has finished, marked on the clock they share. */
          const overs = [];
          for (let i = 1; i < us.length; i++) {
            const a = us[i - 1], b = us[i];
            if (b.who !== a.who && b.s < a.e) overs.push({ s: b.s, e: Math.min(a.e, b.e) });
          }
          const shade = el('div', 'fw-ex-overs');
          overs.forEach((o) => {
            const m = el('span', 'fw-ex-over');
            m.style.left = (100 * o.s / span).toFixed(2) + '%';
            m.style.width = (100 * Math.max(0.25, o.e - o.s) / span).toFixed(2) + '%';
            m.title = 'both speaking, ' + (o.e - o.s).toFixed(1) + 's';
            shade.appendChild(m);
          });
          lanes.appendChild(shade);
          body.appendChild(lanes);

          const axis = el('div', 'fw-ex-axis');
          ['0s', Math.round(span / 2) + 's', span + 's'].forEach((x) => {
            const sp = el('span');
            sp.textContent = x;
            axis.appendChild(sp);
          });
          body.appendChild(axis);

          // The turns themselves, so the strip above is a picture of something the reader
          // has actually read rather than an abstraction of one.
          const talk = el('div', 'fw-ex-talk');
          us.slice(0, EX.turns || 2).forEach((u) => {
            const line = el('p', 'fw-ex-line is-' + u.who);
            const wl = el('span', 'fw-ex-who');
            wl.textContent = u.who === 'agent' ? 'Agent' : 'Caller';
            line.appendChild(wl);
            const txt = String(u.text || '');
            line.appendChild(document.createTextNode(
              txt.length > 190 ? txt.slice(0, 189).replace(/\s+\S*$/, '') + '…' : txt));
            talk.appendChild(line);
          });
          body.appendChild(talk);

          const worst = overs.reduce((m, o) => Math.max(m, o.e - o.s), 0);
          const foot = el('p', 'fw-ex-foot');
          foot.textContent = overs.length
            ? overs.length + (overs.length === 1 ? ' moment' : ' moments') + ' in the first '
              + span + ' seconds where both are speaking, the longest ' + worst.toFixed(1)
              + ' seconds. Neither side is told whose turn it is.'
            : 'No overlap in the first ' + span + ' seconds of this call.';
          body.appendChild(foot);

          if (EX.more && EX.more.href) {
            const a = el('a', 'fw-hn-more');
            a.href = EX.more.href;
            a.textContent = EX.more.label || 'Watch a whole call, tick by tick';
            body.appendChild(a);
          }
          measureSpill();
        })
        .catch((e) => {
          console.warn('flight: example call "' + EX.call + '" did not load:', e.message);
          body.textContent = 'This example call did not load.';
        });
    }

    if (s.worked) {
      const W = s.worked;
      const fig = el('figure', 'fw-work');
      fig.setAttribute('role', 'img');
      fig.setAttribute('aria-label', 'One Pathfinding scenario run five times: four of five '
        + 'arrive, three of five stay inside the efficiency limit, and all three of three '
        + 'succeed in one draw out of ten. The same runs give goal state 0.800, Pass@1 '
        + '0.600 and Pass-cubed 0.100.');
      if (W.label) {
        const h = el('figcaption', 'fw-work-h');
        h.textContent = W.label;
        fig.appendChild(h);
      }
      const opt = W.optimal, lim = W.limit;
      const widest = Math.max(...W.runs.map((r) => r.blocks || 0), opt) * 1.12;
      const rows = el('div', 'fw-work-rows');
      W.runs.forEach((r, k) => {
        const row = el('div', 'fw-work-row' + (r.blocks ? (r.blocks <= opt / lim ? ' is-pass' : ' is-fail') : ' is-none'));
        const nm = el('span', 'fw-work-n');
        nm.textContent = 'Run ' + (k + 1);
        const track = el('div', 'fw-work-t');
        if (r.blocks) {
          const bar = el('div', 'fw-work-b');
          bar.style.width = (100 * r.blocks / widest).toFixed(2) + '%';
          track.appendChild(bar);
          const tick = el('i', 'fw-work-opt');
          tick.style.left = (100 * opt / widest).toFixed(2) + '%';
          const dash = el('i', 'fw-work-lim');
          dash.style.left = (100 * (opt / lim) / widest).toFixed(2) + '%';
          track.append(tick, dash);
        }
        const val = el('span', 'fw-work-v');
        val.textContent = r.blocks ? (r.blocks + ' blocks  ' + Math.round(100 * opt / r.blocks) + '%')
                                   : 'no arrival';
        /* The verdict in a word, not only in a colour. Three of these runs differ from
           each other ONLY by where the bar ends relative to a dashed line, which is a lot
           to ask a reader to decode - and asks a red-green colour-blind reader to decode
           it from two hues that look the same to them. */
        const chip = el('span', 'fw-work-c');
        chip.textContent = r.blocks ? (r.blocks <= opt / lim ? 'Pass' : 'Fail') : 'No arrival';
        row.append(nm, track, chip, val);
        rows.appendChild(row);
      });
      fig.appendChild(rows);
      const key = el('div', 'fw-work-key');
      key.textContent = 'bar = blocks walked  ·  solid tick = the ' + opt
        + '-block optimum  ·  dashed = the ' + Math.round(lim * 100) + '% efficiency limit';
      fig.appendChild(key);

      // The three numbers, computed from the runs above rather than typed beside them.
      const n = W.runs.length;
      const arrived = W.runs.filter((r) => r.blocks).length;
      const passed = W.runs.filter((r) => r.blocks && r.blocks <= opt / lim).length;
      const C = (a, b) => (b > a ? 0 : Array.from({ length: b })
        .reduce((acc, _, i) => acc * (a - i) / (i + 1), 1));
      const p3 = C(n, 3) ? C(passed, 3) / C(n, 3) : 0;
      const out = el('div', 'fw-work-out');
      [['GS', arrived / n, arrived + ' of ' + n + ' arrived'],
       ['Pass@1', passed / n, passed + ' of ' + n + ' pass'],
       ['Pass\u00b3', p3, 'C(' + passed + ',3) / C(' + n + ',3)']].forEach(([k2, v, why]) => {
        const c = el('div', 'fw-work-cell');
        const kk = el('b', '');
        kk.textContent = k2;
        const vv = el('strong', '');
        vv.textContent = v.toFixed(3);
        const ww = el('span', '');
        ww.textContent = why;
        c.append(kk, vv, ww);
        out.appendChild(c);
      });
      fig.appendChild(out);
      p.appendChild(fig);
    }

    /* Cards: a heading, a line, and a list. Used for the three metric pillars and for the
       nine enterprise conversation types, which are the same shape of object - a named
       thing with one sentence and some contents. */
    /* The three pillars, one column each.
       ---------------------------------------------------------------------------
       The pillar structure IS the paper's central design decision, and as a flat glossary
       it was invisible. Each metric states four things in a fixed order: symbol, full
       name, one plain sentence, and the range with its direction - the last of which the
       glossary never gave, so a reader could not tell which way was better. */
    /* Small multiples: one panel per conversation type, five bars each, ONE shared axis.
       ---------------------------------------------------------------------------
       A panel per type is only comparable if the scale does not move between panels, so
       the maximum is set once for the whole figure. Systems are direct-labelled in the
       first panel only; after that the colour carries the identity, which is the entire
       reason a system keeps one hue across this page. */
    /* The three shapes navigation elicits, said in words beside the walks that show them.
       Six replayed maps demonstrate the behaviour but never name the design. */
    if (s.navCards) {
      if (s.lede) {
        const le = el('p', 'fw-navlede');
        le.textContent = s.lede;
        p.appendChild(le);
      }
      const wrap = el('div', 'fw-navcards');
      s.navCards.forEach((c) => {
        const a = el('article', 'fw-navcard');
        const h = el('h3', 'fw-navcard-h');
        h.textContent = c.name;
        const l = el('p', 'fw-navcard-l');
        l.textContent = c.line;
        a.append(h, l);
        wrap.appendChild(a);
      });
      p.appendChild(wrap);
    }

    if (s.multiples) {
      const M = s.multiples;
      const fig = el('figure', 'fw-sm');
      if (s.lede) {
        const le = el('p', 'fw-sm-lede');
        le.textContent = s.lede;
        fig.appendChild(le);
      }
      let firstPanel = true;
      (M.groups || []).forEach((g) => {
        const gr = el('section', 'fw-sm-grp' + (g.apart ? ' is-apart' : ''));
        const gl = el('h3', 'fw-sm-gl');
        gl.textContent = g.label;
        gr.appendChild(gl);
        const wrap = el('div', 'fw-sm-wrap');
        g.rows.forEach((row) => {
          const pan = el('div', 'fw-sm-pan');
          const nm = el('div', 'fw-sm-name');
          nm.textContent = row.name;
          pan.appendChild(nm);
          const key = firstPanel;
          row.v.forEach((v, k) => {
            const sys = M.systems[k];
            const r = el('div', 'fw-sm-row');
            r.style.setProperty('--sys', sysColor(sys));
            if (key) {
              const lb = el('span', 'fw-sm-sys');
              lb.textContent = sys;
              r.appendChild(lb);
            }
            const tr = el('div', 'fw-sm-track');
            const ba = el('div', 'fw-sm-bar');
            ba.style.width = (100 * Math.min(1, v / M.max)).toFixed(2) + '%';
            tr.appendChild(ba);
            const va = el('span', 'fw-sm-val');
            va.textContent = v.toFixed(3);
            r.append(tr, va);
            r.title = sys + ' \u00b7 ' + row.name + ' \u00b7 Pass@1 ' + v.toFixed(3);
            pan.appendChild(r);
          });
          firstPanel = false;
          wrap.appendChild(pan);
        });
        gr.appendChild(wrap);
        fig.appendChild(gr);
      });
      if (M.note) {
        const nt = el('div', 'fw-sm-note');
        nt.textContent = M.note;
        fig.appendChild(nt);
      }
      fig.setAttribute('role', 'img');
      fig.setAttribute('aria-label', (s.lede || '')
        + ' Pass@1 for five systems across each conversation type, on one shared scale. '
        + (M.groups || []).flatMap((g) => (g.rows || []).map((row) =>
            row.name + ': '
            + (row.v || []).map((v, k) => M.systems[k] + ' ' + v.toFixed(3)).join(', ')
          )).join('. ')
        + '. ' + (M.note || ''));
      addZoom(fig, 'Pass@1 by conversation type');
      p.appendChild(fig);
    }

    if (s.pillarCols) {
      const cols = el('div', 'fw-pil');
      s.pillarCols.forEach((g) => {
        const col = el('section', 'fw-pil-col');
        col.style.setProperty('--tint', g.tint || 'var(--ink)');
        // The same hue, darkened to clear 4.5:1 as text. A fill can be vivid; a label
        // in the same colour cannot.
        const tt = String(g.tint || '').match(/--pillar-[a-z]+/);
        col.style.setProperty('--tint-t', tt ? 'var(' + tt[0] + '-t)' : 'var(--ink)');
        const hd = el('header', 'fw-pil-head');
        const h = el('h3', 'fw-pil-h');
        h.textContent = g.name;
        hd.appendChild(h);
        if (g.line) {
          const l = el('p', 'fw-pil-l');
          l.textContent = g.line;
          hd.appendChild(l);
        }
        col.appendChild(hd);
        (g.metrics || []).forEach((m) => {
          const card = el('article', 'fw-pil-m');
          const sy = el('div', 'fw-pil-sym');
          sy.textContent = m.sym;
          const fu = el('div', 'fw-pil-full');
          fu.textContent = m.full;
          const sa = el('p', 'fw-pil-says');
          sa.textContent = m.says;
          card.append(sy, fu, sa);
          if (m.range) {
            const rg = el('div', 'fw-pil-range');
            rg.textContent = m.range;
            card.appendChild(rg);
          }
          col.appendChild(card);
        });
        cols.appendChild(col);
      });
      p.appendChild(cols);
    }

    /* The one claim the paper makes that no chart can carry. */
    if (s.callout) {
      const co = el('aside', 'fw-callout');
      const h = el('b', 'fw-callout-h');
      h.textContent = s.callout.head;
      const b = el('p', 'fw-callout-b');
      b.textContent = s.callout.body;
      co.append(h, b);
      p.appendChild(co);
    }

    if (s.cards && s.cards.length) {
      const grid = el('div', 'fw-cards' + (s.cardCols ? ' is-c' + s.cardCols : ''));
      s.cards.forEach((c) => {
        const card = el('article', 'fw-card');
        if (c.accent) card.style.setProperty('--tint', c.accent);
        // The paper's own mark for this conversation type. Same glyph in both places, so
        // a reader who has seen the table recognises the card without reading it.
        if (c.icon) {
          const ic = el('div', 'fw-card-ic');
          ic.appendChild(artImg(c.icon, '', 'fw-card-icimg'));
          card.appendChild(ic);
        }
        const h = el('h3', 'fw-card-h');
        h.textContent = c.name;
        card.appendChild(h);
        if (c.line) {
          const l = el('p', 'fw-card-l');
          l.textContent = c.line;
          card.appendChild(l);
        }
        (c.items || []).forEach((it) => {
          const row = el('div', 'fw-card-i');
          const k = el('b', '');
          k.textContent = it[0];
          const v = el('span', '');
          v.textContent = it[1];
          row.append(k, v);
          card.appendChild(row);
        });
        // A short exchange, set the way a messaging app sets one, so the shape of the
        // conversation type is visible rather than described.
        (c.chat || []).forEach((line) => {
          const b = el('div', 'fw-chat ' + (line[0] === 'a' ? 'is-agent' : 'is-user'));
          b.textContent = line[1];
          card.appendChild(b);
        });
        grid.appendChild(card);
      });
      if (s.cardsLede) {
        const le = el('p', 'fw-cards-lede');
        le.textContent = s.cardsLede;
        p.appendChild(le);
      }
      p.appendChild(grid);
      // Nine here, eleven in the corpus. Stating the difference is what stops the two
      // navigation-only shapes reading as an inconsistency.
      if (s.cardsFoot) {
        const fo = el('p', 'fw-cards-foot');
        fo.textContent = s.cardsFoot;
        p.appendChild(fo);
      }
    }

    /* Five recorded runs, side by side.
       ---------------------------------------------------------------------------
       Two of them are Pathfinding, so they show the walk itself, looping, the same live
       renderer the walks stop uses. The other three are enterprise calls, where there is no
       map to show - the whole event is what was said - so they loop the handful of turns in
       which the thing the conversation type is named for actually happens.

       A transcript window, not a whole call: these run four to six minutes and the moment
       that matters is twenty seconds of it. The window is chosen per run and stated in the
       config, so what is on screen is a real excerpt at a real timestamp rather than the
       opening pleasantries every call happens to share. */
    /* The composition matrix: worlds by conversation type.
       ---------------------------------------------------------------------------
       This replaces two donut charts. Eleven slices of near-equal size is eleven legend
       lookups to learn "they are all about equal", and two separate pies destroy the one
       structural fact the benchmark rests on: worlds and types are CROSSED.

       No colour ramp. Every non-empty cell is 3 by design, so a sequential scale would be
       encoding a constant. One fill, one numeral. Empty combinations are drawn as outlined
       squares rather than left blank, because a gap has to read as "deliberately empty"
       and never as "data missing". */
    /* Duration violins, one row per world.
       ---------------------------------------------------------------------------
       Horizontal because the world names are long, sorted by median descending, one
       shared x-axis so the comparison is legitimate, and ONE colour: the comparison is
       between shapes, and six hues would invite a meaning that is not there.

       The censoring is the finding, so it is drawn three ways rather than smoothed away:
       the kernel is clipped to the observed range at build time, the cap is a dashed
       rule, and the mass that ends there is a solid stub whose height is the count. An
       unbounded kernel would draw density past twenty minutes, where no conversation can
       exist, which would be a fabrication. */
    if (s.violins) {
      const host = el('figure', 'fw-vio');
      const wrap = el('div', 'fw-vio-rows');
      host.appendChild(wrap);
      const cap = el('figcaption', 'fw-vio-cap');
      host.appendChild(cap);
      p.appendChild(host);
      const V = s.violins;
      fetch(V.src).then((r) => r.json()).then((d) => {
        const M = d.meta;
        const X = (v) => (100 * Math.min(1, Math.max(0, v / M.xmax))).toFixed(3) + '%';
        // Axis first, so the rows below hang off a stated scale rather than an implied one.
        const ax = el('div', 'fw-vio-axis');
        for (let x = 0; x <= M.xmax; x += 5) {
          const tk = el('span', 'fw-vio-tick');
          tk.style.left = X(x);
          tk.textContent = String(x);
          ax.appendChild(tk);
        }
        const capline = el('span', 'fw-vio-capline');
        capline.style.left = X(M.cap);
        const cl = el('b', '');
        cl.textContent = 'step cap';
        capline.appendChild(cl);
        ax.appendChild(capline);
        wrap.appendChild(ax);

        d.worlds.forEach((w) => {
          const row = el('div', 'fw-vio-row' + (w.key === 'nyc_geo' ? ' is-apart' : ''));
          const nm = el('div', 'fw-vio-name');
          nm.textContent = w.world;
          const plot = el('div', 'fw-vio-plot');

          // The mirrored density, as one filled path in user units 0..xmax by -1..1.
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 ' + M.xmax + ' 2');
          svg.setAttribute('preserveAspectRatio', 'none');
          svg.setAttribute('class', 'fw-vio-svg');
          const top = [], bot = [];
          w.dens.forEach((v, k) => {
            const x = (w.lo + k * w.step).toFixed(4);
            const h = (v / M.peak).toFixed(4);
            top.push(x + ',' + (1 - h).toFixed(4));
            bot.push(x + ',' + (1 + Number(h)).toFixed(4));
          });
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', 'M' + top.join(' L') + ' L' + bot.reverse().join(' L') + ' Z');
          path.setAttribute('class', 'fw-vio-body');
          path.setAttribute('vector-effect', 'non-scaling-stroke');
          svg.appendChild(path);
          plot.appendChild(svg);

          // Box overlay. The violin gives the shape; this gives the numbers people quote.
          const whisk = el('div', 'fw-vio-whisk');
          whisk.style.left = X(w.p5);
          whisk.style.width = X(w.p95 - w.p5);
          const box = el('div', 'fw-vio-box');
          box.style.left = X(w.q1);
          box.style.width = X(w.q3 - w.q1);
          const med = el('div', 'fw-vio-med');
          med.style.left = X(w.med);
          plot.append(whisk, box, med);

          // The censored mass, as real data at a hard boundary.
          if (w.atCap > 0) {
            const stub = el('div', 'fw-vio-stub');
            stub.style.left = X(M.cap);
            stub.style.setProperty('--h', (100 * w.atCap / w.n).toFixed(1) + '%');
            stub.title = w.atCap + ' of ' + w.n + ' runs end at the cap';
            plot.appendChild(stub);
          }

          const gut = el('div', 'fw-vio-gut');
          gut.textContent = 'median ' + w.med.toFixed(1) + ' min \u00b7 n = ' + w.n;
          row.append(nm, plot, gut);
          wrap.appendChild(row);

          if (w.atCap > 0 && w.key === 'nyc_geo') {
            const an = el('div', 'fw-vio-annot');
            an.textContent = w.atCap + ' of ' + w.n + ' runs end at the cap';
            wrap.appendChild(an);
          }
        });
        cap.textContent = V.find || '';
        host.setAttribute('role', 'img');
        host.setAttribute('aria-label', (s.eyebrow || '') + '. ' + (V.find || '') + ' '
          + (d.worlds || []).map((w) => w.world + ': median '
              + (w.median != null ? Number(w.median).toFixed(1) : '?') + ' minutes over '
              + w.n + ' conversations'
              + (w.atCap ? ', ' + w.atCap + ' of them at the cap' : '')
              + (w.censored ? ', ' + w.censored + ' right-censored' : '')).join('. ') + '.');
        addZoom(host, s.eyebrow || 'Conversation duration');
      }).catch(() => { cap.textContent = 'The duration data did not load.'; });
    }

    if (s.matrix) {
      const M = s.matrix;
      const fig = el('figure', 'fw-mx');
      const grid = el('div', 'fw-mx-grid');
      grid.style.setProperty('--n', String(M.types.length));
      grid.style.setProperty('--split', String(M.split));

      // Spanning labels over the two groups of columns, which is what answers the
      // nine-versus-eleven question the old pill cloud created.
      const spanRow = el('div', 'fw-mx-spans');
      (M.spans || []).forEach((txt, k) => {
        const sp = el('div', 'fw-mx-span' + (k ? ' is-nav' : ''));
        sp.style.setProperty('--from', k ? String(M.split + 1) : '1');
        sp.style.setProperty('--to', k ? String(M.types.length + 1) : String(M.split + 1));
        sp.textContent = txt;
        spanRow.appendChild(sp);
      });
      grid.appendChild(spanRow);

      const head = el('div', 'fw-mx-head');
      head.appendChild(el('div', 'fw-mx-corner'));
      M.types.forEach((ty, k) => {
        const h = el('div', 'fw-mx-th' + (k === M.split ? ' is-cut' : ''));
        h.textContent = ty;               // horizontal, never rotated
        head.appendChild(h);
      });
      head.appendChild(el('div', 'fw-mx-corner'));
      grid.appendChild(head);

      const colTot = M.types.map(() => 0);
      M.rows.forEach((r) => {
        const row = el('div', 'fw-mx-row' + (r.apart ? ' is-apart' : ''));
        const nm = el('div', 'fw-mx-world');
        if (r.img) nm.appendChild(artImg(r.img, '', 'fw-mx-globe'));
        const wn = el('span', '');
        wn.textContent = r.world;
        nm.appendChild(wn);
        row.appendChild(nm);
        let tot = 0;
        r.cells.forEach((v, k) => {
          colTot[k] += v;
          tot += v;
          const c = el('div', 'fw-mx-cell' + (v ? '' : ' is-empty')
            + (k === M.split ? ' is-cut' : ''));
          if (v) {
            c.textContent = String(v);
            // Five systems, five runs each, and Pathfinding is run in two channels.
            // This arithmetic has been wrong twice: "3 scenarios x 5 runs = 15" summed to
            // 720, and a later "3 runs" summed to 2,295. Both were checked against the
            // 3,825 this page reports elsewhere, which is the only test that catches it.
            const chans = M.channels && M.channels[r.world] ? M.channels[r.world] : 1;
            const convs = v * (M.systems || 5) * (M.runs || 5) * chans;
            c.title = r.world + ' \u00b7 ' + M.types[k] + ': ' + v + ' scenarios, '
              + convs + ' conversations (' + v + ' \u00d7 ' + (M.systems || 5)
              + ' systems \u00d7 ' + (M.runs || 5) + ' runs'
              + (chans > 1 ? ' \u00d7 ' + chans + ' channels' : '') + ')';
          } else {
            c.setAttribute('aria-hidden', 'true');
          }
          row.appendChild(c);
        });
        // The row marginal: one of the two pies this replaces, put where it belongs.
        const mg = el('div', 'fw-mx-marg');
        const b = el('div', 'fw-mx-margbar');
        b.style.setProperty('--w', (100 * tot / 27).toFixed(1) + '%');
        const bn = el('span', '');
        bn.textContent = String(tot);
        mg.append(b, bn);
        row.appendChild(mg);
        grid.appendChild(row);
      });

      const foot = el('div', 'fw-mx-foot');
      foot.appendChild(el('div', 'fw-mx-corner'));
      colTot.forEach((v, k) => {
        const c = el('div', 'fw-mx-colt' + (k === M.split ? ' is-cut' : ''));
        const b = el('div', 'fw-mx-coltbar');
        b.style.setProperty('--h', (100 * v / 18).toFixed(1) + '%');
        const n = el('span', '');
        n.textContent = String(v);
        c.append(b, n);
        foot.appendChild(c);
      });
      const tt = el('div', 'fw-mx-total');
      tt.textContent = String(colTot.reduce((a, b) => a + b, 0));
      foot.appendChild(tt);
      /* The matrix implies a corpus size, and that number is printed elsewhere on the site
         from a different source. If the two ever disagree the page is quietly lying in one
         of two places, so say so in the console rather than let a reader find it. */
      if (M.corpus) {
        const implied = M.rows.reduce((sum, r) => {
          const ch = M.channels && M.channels[r.world] ? M.channels[r.world] : 1;
          return sum + r.cells.reduce((a, v) => a + v, 0) * ch;
        }, 0) * (M.systems || 5) * (M.runs || 5);
        if (implied !== M.corpus) {
          console.warn('composition matrix implies ' + implied
            + ' conversations, the page reports ' + M.corpus);
        }
      }
      grid.appendChild(foot);
      fig.appendChild(grid);

      const cap = el('figcaption', 'fw-mx-cap');
      cap.textContent = M.find || '';
      fig.appendChild(cap);
      if (M.foot) {
        const fn = el('div', 'fw-mx-note');
        fn.textContent = M.foot;
        fig.appendChild(fn);
      }
      /* role="img" makes every descendant presentational, so whatever the figure prints
         is deleted from the accessibility tree and the label is ALL a screen reader gets.
         A label that only restates the caption therefore deletes the data: 85 numbers here,
         253 in the small multiples. So the label carries the grid, row by row. */
      fig.setAttribute('role', 'img');
      fig.setAttribute('aria-label', (s.eyebrow || '') + '. ' + (M.find || '') + ' '
        + M.rows.map((r) => r.world + ': '
            + r.cells.map((v, k) => (v ? M.types[k] + ' ' + v : null))
                     .filter(Boolean).join(', ')
            + '; ' + r.cells.reduce((a, b) => a + b, 0) + ' in total').join('. ')
        + '. ' + (M.foot || ''));
      addZoom(fig, s.eyebrow || 'Composition');
      p.appendChild(fig);
    }

    if (s.runs && s.runs.length) {
      const grid = el('div', 'fw-runs');
      grid.style.setProperty('--n', String(s.runs.length));
      // `steps` on the section stages this grid the way it stages the walks on the setup
      // page: one tile filling the frame, then two, then three. Marked here so the sheet
      // can tell which tile is meant to be up at which step; without `steps` the class is
      // absent and every tile is up from the first frame, exactly as before.
      if (s.steps > 1) grid.classList.add('is-staged');
      s.runs.forEach((r, ri) => {
        const fig = el('figure', 'fw-run is-' + (r.outcome || 'ok'));
        fig.dataset.kind = r.map ? 'map' : 'call';
        fig.dataset.at = String(ri);
        const head = el('figcaption', 'fw-run-head');
        const ty = el('span', 'fw-run-type');
        ty.textContent = r.type || '';
        const wh = el('span', 'fw-run-where');
        wh.textContent = r.world || '';
        head.append(ty, wh);
        // Which system is speaking. Five tiles from four different systems is not a detail
        // a reader can be expected to infer, and an unattributed sample invites the reading
        // that all five are the same agent.
        if (r.model) {
          const md = el('span', 'fw-run-model');
          md.innerHTML = vendorMark(r.model);
          const mn = el('b', '');
          mn.textContent = r.model;
          md.appendChild(mn);
          head.appendChild(md);
        }
        const box = el('div', 'fw-run-box');
        const wait = el('div', 'fw-map-wait');
        wait.textContent = 'loading';
        box.appendChild(wait);
        fig.append(head, box);
        /* A player, not <audio controls>: the default control is 300px of grey chrome that
           would wreck the visual system, and it offers a volume slider and a download menu
           this page has no use for. One button, one bar in the system's own colour, and the
           clock. The bar is a real <input type=range> so it is keyboard operable and reads
           as a slider to assistive technology. */
        // A Pathfinding tile carries a voice payload rather than a bare audio file: its
        // playback is owned by the walk renderer, which drives the map from the recording.
        /* A walk tile carries NO player. Pressing play on it used to switch the tile into
           the renderer's voice mode, which swaps the map for the transcript - so starting
           the audio covered the very thing the tile is there to show, in a 300px box. The
           recording, the speech activity timeline and the transcript all moved to the open
           view, where there is room for them beside the map. */
        if (r.audio && !(r.map && r.voice)) {
          const pl = el('div', 'fw-pl');
          pl.style.setProperty('--sys', sysColor(r.model || ''));
          pl.style.setProperty('--on-sys', sysInk(r.model || ''));
          // Built only when there IS a file. A Pathfinding tile carries a voice payload
          // instead, and its playback belongs to the walk renderer; constructing an
          // <audio> for it threw on an undefined source before the branch below could
          // ever run, which took the whole page down with it.
          const au = document.createElement('audio');
          au.preload = 'none';                       // fetched only when somebody presses play
          if (r.audio) {
          // Two sources, because one format does not reach every browser: Safari does not
          // play Ogg-Opus at all, and a single .opus source fails there with a bare
          // "source not supported" and no visible reason.
          //
          // Opus FIRST, then AAC, for the same reason openCall lists them that way: Chrome
          // reports Opus as "probably" and takes the first it can play, so listing AAC
          // first made every Chrome reader download the larger file - measured at +57%
          // across the set - while Safari, which cannot decode Ogg at all, falls through
          // to the AAC either way. This player was left on the old order after openCall
          // was corrected, so the tile on samples.html was still pulling the bigger file.
          const primary = artSrc(r.audio)[0] || r.audio;
          const aac = primary.replace(/\.opus$/i, '.m4a');
          [[primary, 'audio/ogg; codecs=opus'], [aac, 'audio/mp4']].forEach(([u, ty]) => {
            const so = document.createElement('source');
            so.src = u;
            so.type = ty;
            au.appendChild(so);
          });
          }
          const btn = el('button', 'fw-pl-btn');
          btn.type = 'button';
          btn.setAttribute('aria-label', 'Play ' + (r.type || '') + ', ' + (r.world || ''));
          btn.innerHTML = PLAY_SVG;
          const bar = document.createElement('input');
          bar.type = 'range';
          bar.className = 'fw-pl-bar';
          bar.min = '0'; bar.max = '1000'; bar.value = '0';
          bar.setAttribute('aria-label', 'Position in the recording');
          const tm = el('span', 'fw-pl-time');
          tm.textContent = '0:00';
          const clock = (s2) => {
            if (!isFinite(s2)) return '0:00';
            const m = Math.floor(s2 / 60);
            return m + ':' + String(Math.floor(s2 % 60)).padStart(2, '0');
          };
          /* A Pathfinding tile with a recording does not use this <audio> at all.
             ------------------------------------------------------------------------
             The walk renderer has its own voice mode: it swaps the looping walk for the
             REAL call clock and opens the two-lane speech activity timeline - who held
             the channel, where they talked over each other, every tool call and every
             audio effect the harness applied. That timeline is the thing this benchmark
             is about, and it already exists; the play button just has to ask for it. */
          if (r.map && r.voice) {
            pl.addEventListener('click', (e) => e.stopPropagation());
            let vloaded = null;
            btn.addEventListener('click', (e) => {
              // The tile itself opens the full-size walk on click. Without this the play
              // button opened that overlay instead of starting the recording.
              e.stopPropagation();
              const inst = mapLive[r.map];
              if (!inst) return;
              const start = () => {
                inst.setVoiceMode(true);
                const a = fig.querySelector('.wm-root audio');
                if (!a) return;
                // Its own transport, not the element: voice mode drives the map from the
                // recording's clock, and calling play() behind its back leaves the two
                // out of step - the audio ran while the map sat still.
                const transport = fig.querySelector('[data-el="cPlay"]');
                if (a.paused) {
                  document.querySelectorAll('audio').forEach((o) => { if (o !== a) o.pause(); });
                }
                if (transport) transport.click();
                else if (a.paused) a.play().catch(() => {});
                const sync = () => {
                  btn.innerHTML = a.paused ? PLAY_SVG : PAUSE_SVG;
                  pl.classList.toggle('is-on', !a.paused);
                };
                // Bound once per <audio>, not once per press. `start()` runs on every
                // click, including the already-loaded fast path, so an unguarded pair here
                // grew without bound: after four presses each play/pause event ran four
                // copies of sync, every one of them writing innerHTML on the button.
                if (!a.__plBound) {
                  a.__plBound = true;
                  a.addEventListener('play', sync);
                  a.addEventListener('pause', sync);
                }
                setTimeout(sync, 120);
              };
              if (vloaded) { start(); return; }
              // Fetched on demand: the call is megabytes and most readers never ask.
              fetch((MAPS.base || '../') + r.voice)
                .then((res) => (res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status))))
                .then((v) => { vloaded = v; inst.setVoice(v); start(); })
                .catch((e) => {
                  console.warn('flight: voice for "' + r.map + '" did not load:', e.message);
                  tm.textContent = 'recording unavailable';
                });
            });
            pl.append(btn, tm);
            // No scrubber here: the call transport lives on the map, under the timeline.
            tm.textContent = 'Play with the speech activity timeline';
            fig.appendChild(pl);
          } else {
          btn.addEventListener('click', () => {
            if (au.paused) {
              // One clip at a time. A second one starting over the first is the fastest
              // way to make a page of recordings unusable.
              document.querySelectorAll('audio').forEach((o) => { if (o !== au) o.pause(); });
              au.play().catch(() => {});
            } else {
              au.pause();
            }
          });
          au.addEventListener('play', () => { btn.innerHTML = PAUSE_SVG; pl.classList.add('is-on'); });
          au.addEventListener('pause', () => { btn.innerHTML = PLAY_SVG; pl.classList.remove('is-on'); });
          au.addEventListener('ended', () => { bar.value = '0'; tm.textContent = clock(au.duration); });
          au.addEventListener('timeupdate', () => {
            if (au.duration) {
              bar.value = String(Math.round(1000 * au.currentTime / au.duration));
              bar.style.setProperty('--pc', (100 * au.currentTime / au.duration).toFixed(1) + '%');
            }
            tm.textContent = clock(au.currentTime) + ' / ' + clock(au.duration);
            // The transcript follows the recording rather than looping beside it: the
            // playhead moves along the activity strip and the turn being spoken is lit.
            const sync = fig.__sync;
            if (sync) sync(au.currentTime);
          });
          // A recording is the real clock; the looping excerpt is what stands in for it
          // when nothing is playing. They must not run at the same time.
          au.addEventListener('play', () => { if (fig.__stopLoop) fig.__stopLoop(); });
          au.addEventListener('loadedmetadata', () => { tm.textContent = '0:00 / ' + clock(au.duration); });
          bar.addEventListener('input', () => {
            if (au.duration) au.currentTime = au.duration * (Number(bar.value) / 1000);
          });
          pl.append(btn, bar, tm, au);
          fig.appendChild(pl);
          }
        }
        if (r.map) {
          /* EVERY walk tile opens. This used to be gated on the tile having no recording,
             because a tile with one carried a player and clicking the tile would have
             thrown the overlay over the timeline that press had just opened. The player is
             gone - a 300px box is no place to play a call, and voice mode replaced the map
             with the transcript, so starting the audio covered the route the tile exists to
             show. So the tile is a link again, and the recording plays in the open view
             where the map, the timeline and the transcript all fit at once. */
          fig.dataset.key = r.map;
          fig.tabIndex = 0;
          fig.setAttribute('role', 'button');
          fig.setAttribute('aria-label', (r.type || '') + ', ' + (r.world || '')
            + '. Opens the walk full size'
            + (r.voice ? ', with its recording, speech activity timeline and transcript.'
                       : ', with a step control.'));
          const open = (e) => {
            if (e && e.target && e.target.closest && e.target.closest('.fw-pl')) return;
            openWalk({ key: r.map, cond: r.type, note: r.world,
                       voice: r.voice, model: r.model });
          };
          fig.addEventListener('click', open);
          fig.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
          });
        } else {
          fig.dataset.call = r.call;
          fig.dataset.from = String(r.from);
          fig.dataset.to = String(r.to);
          /* An enterprise tile opens the same full view a walk tile does. The tile shows a
             five-turn excerpt and a strip of the activity around it; the whole call, the
             full two-lane timeline and the complete transcript need room the tile does not
             have. Guarded on where the click came from rather than on stopping
             propagation, so pressing play inside the tile still just plays. */
          fig.tabIndex = 0;
          fig.setAttribute('role', 'button');
          fig.setAttribute('aria-label', (r.type || '') + ', ' + (r.world || '') + ', '
            + (r.model || '') + '. Opens the whole call, with its speech activity timeline '
            + 'and full transcript.');
          const openCallTile = (e) => {
            if (e && e.target && e.target.closest && e.target.closest('.fw-pl')) return;
            const D = asTape(callData[r.call]);
            if (!D) return;
            openCall(D, { type: r.type, verdict: r.outcome, model: r.model, line: r.world },
                     fig);
          };
          fig.addEventListener('click', openCallTile);
          fig.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCallTile(e); }
          });
        }
        grid.appendChild(fig);
      });
      p.appendChild(grid);
      runStops.push({ i, cfg: s.runs, grid });
    }

    /* The nine pairs. Each entry names a call payload; the tile is a header, an empty box
       and nothing else until the section is approached, because eighteen timelines built
       at mount would be eighteen transcripts in the DOM behind a hidden panel. */
    if (s.tapes && s.tapes.length) {
      /* The lede belongs to any grid of tiles, not only to a grid of cards. It was read
         solely inside the `cards` branch, so a tapes stop that set one rendered nothing at
         all and the section arrived with no explanation above it. Same for the footnote
         below the grid. */
      if (s.cardsLede) {
        const le = el('p', 'fw-cards-lede');
        le.textContent = s.cardsLede;
        p.appendChild(le);
      }
      const grid = el('div', 'fw-tapes');
      s.tapes.forEach((t) => {
        const D0 = t;
        const fig = el('figure', 'fw-tp is-' + (D0.verdict || 'ok'));
        fig.dataset.key = D0.key;
        const cap = el('figcaption', 'fw-tp-cap');
        const ty = el('span', 'fw-tp-type');
        ty.textContent = D0.type || '';
        const vd = el('span', 'fw-tp-verdict');
        vd.textContent = D0.verdict === 'bad' ? 'Fail' : 'Pass';
        const who = el('span', 'fw-tp-model');
        who.style.setProperty('--sys-t', sysTextColor(D0.model || ''));
        who.innerHTML = vendorMark(D0.model || '');
        const wn = el('span', '');
        wn.textContent = D0.model || '';
        who.appendChild(wn);
        cap.append(ty, vd, who);
        fig.appendChild(cap);
        if (D0.line) {
          const ln = el('p', 'fw-tp-line');
          ln.textContent = D0.line;
          fig.appendChild(ln);
        }
        const box = el('div', 'fw-tp-box');
        box.textContent = 'loading';
        fig.appendChild(box);
        /* The whole tile is the control. A tile that carries a click affordance in one
           corner is a target people miss; the tile IS the thing they want to open. */
        fig.tabIndex = 0;
        fig.setAttribute('role', 'button');
        const open = () => {
          const D = tapeData[D0.key];
          if (!D) return;
          openCall(D, D0, fig);
        };
        fig.addEventListener('click', open);
        fig.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
        fig.setAttribute('aria-label', (D0.type || 'A call') + ', '
          + (D0.verdict === 'bad' ? 'fail' : 'pass') + ', ' + (D0.model || '')
          + '. Opens the call: its speech activity timeline, the recording, and the '
          + 'full transcript.');
        grid.appendChild(fig);
      });
      p.appendChild(grid);
      /* One legend for the whole grid, not one per tile. Every mark on the tape also
         carries a title, but a title is mouse-only, so this is the version that works for
         everyone - and it is what makes the tape readable without the appendix. */
      const lg = el('div', 'fw-tp-legend');
      [['turn_take/contested', 'both spoke at once'],
       ['turn_take/failed', 'handover failed'],
       ['interruption', 'cut in'],
       ['self_correction', 'corrected itself']].forEach(([k, say]) => {
        const w = el('span', '');
        const i = el('i', '');
        i.style.setProperty('--mk', MARK_INK[k]);
        const t = el('span', '');
        t.textContent = say;
        w.append(i, t);
        lg.appendChild(w);
      });
      const tw = el('span', '');
      const ti = el('i', 'is-tool');
      const tt = el('span', '');
      tt.textContent = 'tool call';
      tw.append(ti, tt);
      lg.appendChild(tw);
      const fw = el('span', '');
      const fi = el('i', '');
      fi.style.setProperty('--mk', 'var(--tp-fx)');
      const ft = el('span', '');
      ft.textContent = 'what the harness did to the audio';
      fw.append(fi, ft);
      lg.appendChild(fw);
      p.appendChild(lg);
      if (s.cardsFoot) {
        const fo = el('p', 'fw-cards-foot');
        fo.textContent = s.cardsFoot;
        p.appendChild(fo);
      }
      tapeStops.push({ i, cfg: s.tapes, grid });
    }

    // Front matter. The paper's own abstract, under its own heading, exactly as a project
    // page for a paper should open: what the work is, before any claim about it.
    if (s.abstract) {
      const ab = el('section', 'fw-abstract');
      const ah = el('h2', 'fw-abstract-h');
      ah.textContent = s.abstractLabel || 'Abstract';
      ab.appendChild(ah);
      (Array.isArray(s.abstract) ? s.abstract : [s.abstract]).forEach((para) => {
        const q = el('p', 'fw-abstract-p');
        q.textContent = para;
        ab.appendChild(q);
      });
      p.appendChild(ab);
    }

    // A bar chart, one series. Deliberately not a library: the whole figure is five rows of
    // two divs, and every pixel of width is a number from the table rather than a scale
    // somebody chose. The interval is drawn, not just printed - a 0.533 with a half-width of
    // 0.133 and a 0.490 with a half-width of 0.039 are different claims, and a bare bar
    // chart shows them as the same kind of thing.
    /* A world's own header: its globe, its name, and the one line that says what the
       world isolates. On the half-width layout this lived on the stage as a plate; on a
       band there is no stage, and the name was ending up under its own chart. */
    /* The cinema stop: one line over the picture, and nothing else.
       ---------------------------------------------------------------------------
       Every other block on this site puts type BESIDE the film because it has numbers to
       carry. This one has none: the film is the argument and the words are its caption,
       so they sit on it, large, and get out of the way. */
    if (s.big) {
      const w = el('div', 'fw-cine');
      const h = el('h2', 'fw-cine-big');
      h.textContent = s.big;
      w.appendChild(h);
      if (s.say) {
        const q = el('p', 'fw-cine-say');
        q.textContent = s.say;
        w.appendChild(q);
      }
      (s.go || []).forEach(([label, href]) => {
        const a = el('a', 'fw-cine-go');
        a.href = href;
        a.textContent = label;
        w.appendChild(a);
      });
      p.appendChild(w);
    }

    if (s.plate) {
      const hd = el('header', 'fw-plate');
      if (s.plate.img) hd.appendChild(artImg(s.plate.img, '', 'fw-plate-globe'));
      const tx = el('div', 'fw-plate-tx');
      const h = el('h2', 'fw-plate-name');
      h.textContent = s.plate.name;
      tx.appendChild(h);
      if (s.plate.line) {
        const l = el('p', 'fw-plate-line');
        l.textContent = s.plate.line;
        tx.appendChild(l);
      }
      hd.appendChild(tx);
      p.appendChild(hd);
    }

    if (s.bars) {
      const B = s.bars;
      const rows = B.rows || [];
      // The axis has to clear the widest whisker, not the tallest bar, or the top interval
      // is drawn running off the end of its own track.
      const reach = Math.max(...rows.map((r) => r.v + (r.pm || 0)), 0.0001);
      // An explicit max is a floor, never a ceiling: a whisker that runs past it was being
      // clipped to the axis and drawn as though the interval ended exactly on the last
      // tick. The axis grows to hold the widest interval instead.
      const MAX = Math.max(Number.isFinite(B.max) ? B.max : 0, Math.ceil(reach * 20) / 20);
      const fig = el('figure', 'fw-bars');
      // Stated on the figure, because a figcaption alone leaves the accessible name empty
      // in Chrome: a screen reader got "figure" and no finding at all.
      fig.setAttribute('role', 'img');
      fig.setAttribute('aria-label',
        (B.metric || 'Pass@1') + ' for five systems'
        + (B.label ? ', ' + B.label : '') + '. '
        + rows.map((r) => (r.system || r.name) + ' ' + r.v.toFixed(3)
            + (r.pm ? ' plus or minus ' + r.pm.toFixed(3) : '')).join('; ') + '.');
      if (B.label) {
        const cap = el('figcaption', 'fw-bars-label');
        cap.textContent = B.label;
        fig.appendChild(cap);
      }
      const list = el('div', 'fw-bars-list');
      const fmt = (x) => x.toFixed(B.dp === undefined ? 3 : B.dp);
      rows.forEach((r) => {
        const row = el('div', 'fw-bar-row' + (r.v <= 0 ? ' is-zero' : ''));
        // The system's own colour, the same one it carries on the opening plot and beside
        // its recorded call, so a reader tracks one system across the page by hue.
        row.style.setProperty('--sys', sysColor(r.name || r.system || ''));
        // Focusable, so the read-out is reachable without a pointer. A <div> with tabindex
        // rather than a <button>: there is nothing to activate, and announcing five buttons
        // that do nothing is worse than announcing five values.
        row.tabIndex = 0;
        const nm = el('div', 'fw-bar-name');
        nm.innerHTML = vendorMark(r.system);
        const nmt = el('span', '');
        nmt.textContent = r.system;
        nm.appendChild(nmt);
        const track = el('div', 'fw-bar-track');
        const fill = el('div', 'fw-bar-fill');
        fill.style.setProperty('--w', (100 * r.v / MAX).toFixed(2) + '%');
        track.appendChild(fill);
        if (r.pm) {
          const ci = el('div', 'fw-bar-ci');
          const lo = Math.max(0, r.v - r.pm), hi = Math.min(MAX, r.v + r.pm);
          ci.style.left = (100 * lo / MAX).toFixed(2) + '%';
          ci.style.width = (100 * (hi - lo) / MAX).toFixed(2) + '%';
          track.appendChild(ci);
        }
        const val = el('div', 'fw-bar-val');
        const vb = el('strong', '');
        vb.textContent = fmt(r.v);
        val.appendChild(vb);
        if (r.pm) {
          const pm = el('span', 'fw-pm');
          pm.textContent = '±' + fmt(r.pm).replace(/^0/, '');
          val.appendChild(pm);
        }
        const tip = el('div', 'fw-bar-tip');
        tip.textContent = r.tip || (r.system + ' · ' + (B.metric || 'value') + ' ' + fmt(r.v)
          + (r.pm ? ' (95% interval ' + fmt(r.v - r.pm) + ' to ' + fmt(r.v + r.pm) + ')' : ''));
        row.append(nm, track, val, tip);
        // No aria-label. It was prohibited here - the row is a nameless `generic`, and a
        // name on one is unreliable in every major screen reader - and it was also
        // unnecessary: the system and its value are real text inside the row already. The
        // track and the whisker are the decoration, so those are what get hidden.
        track.setAttribute('aria-hidden', 'true');
        tip.setAttribute('aria-hidden', 'true');
        list.appendChild(row);
      });
      fig.appendChild(list);
      if (B.axis !== false) {
        // Three children, matching the row grid: an empty cell under the names, the ticks
        // over the track, an empty cell under the values. Laid out rather than nudged
        // across with a margin, because the two were measured in different fonts' `ch` and
        // the axis ended up 64px left of the bars it labels.
        const ax = el('div', 'fw-bars-axis');
        ax.setAttribute('aria-hidden', 'true');    // the values are on the rows themselves
        const ticks = el('div', 'fw-axis-ticks');
        [0, MAX / 2, MAX].forEach((t) => {
          const tk = el('span', '');
          tk.textContent = fmt(t);
          ticks.appendChild(tk);
        });
        ax.append(el('span', ''), ticks, el('span', ''));
        fig.appendChild(ax);
      }
      if (B.note) {
        const n = el('p', 'fw-bars-note');
        n.textContent = B.note;
        fig.appendChild(n);
      }
      p.appendChild(fig);
    }

    // The main table, as the paper prints it: three pillars over eleven metrics, every cell
    // carrying its own 95% bootstrap half-width. The half-widths are the reason this is worth
    // the width it costs - without them the Pathfinding block reads as five separated systems
    // when three of its intervals overlap.
    if (s.pillars) {
      const P = s.pillars;
      const cols = P.groups.flatMap((g) => g.cols);
      const tbl = el('table', 'fw-pillars' + (P.reveal ? ' is-staged' : ''));
      // A results table with no caption announces as an unnamed table. This says which
      // world it reports and how it is read, before the reader enters 55 cells.
      // A table takes exactly one caption. The visible sentence and the screen-reader
      // sentence therefore live in one element, the second half hidden, rather than as
      // two caption nodes where the browser silently drops the later one.
      const cap = el('caption', 'fw-p-cap' + (P.caption ? '' : ' fw-sr'));
      if (P.caption) {
        const vis = el('span', 'fw-p-cap-t');
        vis.textContent = P.caption;
        cap.appendChild(vis);
      }
      const sr = el('span', 'fw-sr');
      sr.textContent = (s.mark && s.mark.name ? s.mark.name + ': ' : '')
        + 'five systems across eleven metrics in three pillars, '
        + 'each with its 95% interval. Higher is better throughout.';
      cap.appendChild(sr);
      tbl.appendChild(cap);
      const thead = el('thead', '');
      const gr = el('tr', 'fw-p-groups');
      gr.appendChild(el('td', 'fw-p-corner'));
      P.groups.forEach((g) => {
        const th = el('th', 'fw-p-group');
        th.colSpan = g.cols.length;
        th.scope = 'colgroup';
        th.textContent = g.name;
        gr.appendChild(th);
      });
      /* Sortable, because seven static tables of eleven columns is a lookup exercise:
         a reader who wants to know who leads DNSMOS in Travel should not have to scan 55
         cells. Clicking a metric sorts by it; clicking again reverses. Presentation only -
         no number moves, only the order of the rows. */
      const sortBy = (j, dir) => {
        const body = tb;
        const rows = [...body.querySelectorAll('tr')];
        rows.sort((a, b) => {
          const va = j < 0 ? 0 : parseFloat(a.children[j + 1].textContent) || 0;
          const vb = j < 0 ? 0 : parseFloat(b.children[j + 1].textContent) || 0;
          return dir === 'asc' ? va - vb : vb - va;
        });
        rows.forEach((r) => body.appendChild(r));
        tbl.querySelectorAll('th.fw-p-metric').forEach((h, k) => {
          const on = k === j;
          h.dataset.sort = on ? dir : '';
          h.setAttribute('aria-sort', on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
        });
      };
      const mr = el('tr', 'fw-p-metrics');
      const corner = el('th', 'fw-p-sys');
      corner.scope = 'col';
      corner.textContent = P.rowHead || 'System';
      mr.appendChild(corner);
      let ci = 0;
      P.groups.forEach((g) => g.cols.forEach((c) => {
        const th = el('th', 'fw-p-metric');
        th.scope = 'col';
        th.dataset.col = String(ci);
        const j = ci;
        ci += 1;
        // A real button inside the header, so it is reachable by keyboard and announces
        // itself as something operable rather than as a heading that happens to react.
        const sb = el('button', 'fw-p-sortbtn');
        sb.type = 'button';
        sb.textContent = c;
        sb.setAttribute('aria-label', 'Sort by ' + c);
        let dir = 'desc';
        sb.addEventListener('click', () => {
          dir = th.dataset.sort === 'desc' ? 'asc' : 'desc';
          sortBy(j, dir);
        });
        th.appendChild(sb);
        th.setAttribute('aria-sort', 'none');
        mr.appendChild(th);
      }));
      thead.append(gr, mr);
      // Best per column, computed rather than hand-marked, and direction-aware: this suite
      // has lower-is-better columns, and a silent max would bold the worst system in one.
      // Non-numeric cells are filtered rather than fed to Math.max, which returns NaN and
      // unbolds a whole column with nothing to show that anything went wrong.
      const dirs = P.best || cols.map(() => 'high');
      const best = cols.map((_, j) => {
        const nums = P.rows.map((r) => parseFloat(r.vals[j] && r.vals[j][0]))
                           .filter(Number.isFinite);
        if (!nums.length) return null;
        return dirs[j] === 'low' ? Math.min(...nums) : Math.max(...nums);
      });
      const tb = el('tbody', '');
      P.rows.forEach((r, ri) => {
        const tr = el('tr', '');
        tr.dataset.row = String(ri);
        const th = el('th', 'fw-p-sys');
        th.scope = 'row';
        const nm = el('span', 'fw-m-sysin');
        nm.innerHTML = vendorMark(r.system);
        const nmt = el('span', '');
        nmt.textContent = r.system;
        nm.appendChild(nmt);
        th.appendChild(nm);
        tr.appendChild(th);
        cols.forEach((_, j) => {
          const cell = r.vals[j] || ['', ''];
          const td = el('td', (best[j] !== null && parseFloat(cell[0]) === best[j]) ? 'is-best' : '');
          const b = el('b', '');
          b.textContent = cell[0];
          td.appendChild(b);
          if (cell[1]) {
            const pm = el('i', 'fw-pm');
            pm.textContent = '±' + cell[1];
            td.appendChild(pm);
          }
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      tbl.append(thead, tb);
      const scroller = el('div', 'fw-pillars-wrap');
      scroller.appendChild(tbl);

      /* A pillar filter. Eleven columns is three questions asked at once, and a reader
         who came for turn-taking is reading past eight columns to find it. Hiding a
         pillar hides its columns; nothing is recomputed and no number changes. */
      const bar = el('div', 'fw-p-filter');
      const lab = el('span', 'fw-p-filter-l');
      lab.textContent = 'Show';
      bar.appendChild(lab);
      const setPillar = (name) => {
        let col = 0;
        P.groups.forEach((g) => {
          const on = !name || g.name === name;
          const from = col, to = col + g.cols.length;
          col = to;
          tbl.querySelectorAll('tr').forEach((tr) => {
            // The group row spans its columns, so index arithmetic does not address it -
            // it is handled by the th.fw-p-group pass below. It used to fall through this
            // loop, get the wrong cells hidden, and be corrected a few lines later purely
            // because that pass happened to run second.
            if (tr.classList.contains('fw-p-groups')) return;
            const cells = [...tr.children];
            // Every remaining row opens with one row-head cell: the metric-name row starts
            // with the corner, the system rows with the system name.
            const off = 1;
            for (let k = from; k < to; k++) {
              const cell = cells[k + off];
              if (cell) cell.hidden = !on;
            }
          });
          tbl.querySelectorAll('th.fw-p-group').forEach((h) => {
            if (h.textContent === g.name) h.hidden = !on;
          });
        });
        bar.querySelectorAll('button').forEach((b) => {
          const on = (b.dataset.pillar || '') === (name || '');
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', String(on));
        });
      };
      [['', 'All pillars']].concat(P.groups.map((g) => [g.name, g.name]))
        .forEach(([key, label]) => {
          const b = el('button', 'fw-p-chip');
          b.type = 'button';
          b.dataset.pillar = key;
          b.textContent = label;
          b.addEventListener('click', () => setPillar(key));
          bar.appendChild(b);
        });
      p.appendChild(bar);
      p.appendChild(scroller);
      setPillar('');
    }

    // The recorded walks, live. Not screenshots and not a video: each panel is the same
    // renderer the gallery at the demo page runs, replaying a real scored conversation from
    // the corpus, looping. What arrives here is `maps.cells` in reading order; which of them
    // are on screen at a given moment is decided by `data-step`, so the grid builds up one
    // job at a time as the reader scrolls through the band.
    if (s.maps) {
      const M = s.maps;
      if (M.label) {
        const ml = el('div', 'fw-cases-label');
        ml.textContent = M.label;
        p.appendChild(ml);
      }
      /* A line of prose over the tiles. `lede` at the SECTION level only renders beside
         navCards or small multiples, so a maps stop without cards had no way to say
         anything at all - the second walks stop shipped with its sentence dropped on the
         floor and no error. This is the same paragraph, owned by the figure it introduces. */
      if (M.lede) {
        const ml = el('p', 'fw-navlede');
        ml.textContent = M.lede;
        p.appendChild(ml);
      }
      const grid = el('div', 'fw-maps');
      grid.style.setProperty('--cols', String(M.cols || 3));
      /* `all` opts a stop OUT of the staged reveal.
         The reveal is driven by `data-step` on the root, which is one number for the whole
         page, so a second maps stop cannot start where the first one finished - it would
         replay the same one-then-two-then-three build the reader has just watched. A stop
         that already has its predecessor's tiles on screen says so, and shows the lot. */
      if (M.all) grid.classList.add('is-all');
      (M.cells || []).forEach((c, idx) => {
        const fig = el('figure', 'fw-map is-' + (c.outcome || 'ok'));
        fig.dataset.at = String(c.at === undefined ? idx : c.at);
        fig.dataset.key = c.key;
        const head = el('figcaption', 'fw-map-head');
        const cond = el('span', 'fw-map-cond');
        cond.textContent = c.cond || '';
        const verdict = el('span', 'fw-map-verdict');
        verdict.textContent = c.verdict || '';
        head.append(cond, verdict);
        const box = el('div', 'fw-map-box');
        // What stands here until the payload arrives, and what stays if it never does. A
        // silently empty box would read as a rendering bug rather than as a slow fetch.
        const wait = el('div', 'fw-map-wait');
        wait.textContent = 'loading the walk';
        box.appendChild(wait);
        const foot = el('div', 'fw-map-foot');
        foot.textContent = c.note || '';
        fig.append(head, box, foot);
        // The whole tile opens the walk, not just the map: at this size the map is a
        // 200px-tall target and the caption above it is the part that reads as clickable.
        fig.tabIndex = 0;
        fig.setAttribute('role', 'button');
        // The note under the map is clamped to two lines, so the mechanism sentence has to
        // reach the reader some other way. Both routes carry it: the tooltip for a pointer,
        // the accessible name for everyone else.
        const full = [c.cond, c.verdict, c.note, c.detail].filter(Boolean).join('. ');
        if (c.detail) fig.title = c.detail;
        fig.setAttribute('aria-label', full + '. Opens full size, with a step control.');
        const open = () => openWalk(c);
        fig.addEventListener('click', open);
        fig.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
        grid.appendChild(fig);
      });
      p.appendChild(grid);
      mapStops.push({ i, cfg: M, grid });
    }

    // A pair stop sits on the moment the chain shows two globes side by side, so the copy
    // is two columns rather than one - each world keeps its own regime, its own leading
    // system and its own number instead of being merged into a paragraph about both.
    if (s.pair && s.pair.length) {
      const pw = el('div', 'fw-pair');
      s.pair.forEach((c) => {
        const col = el('div', 'fw-col');
        const ce = el('div', 'fw-col-eyebrow');
        ce.textContent = c.eyebrow || '';
        col.appendChild(ce);
        if (c.title) {
          const ct = el('h3', 'fw-col-title');
          ct.textContent = c.title;
          col.appendChild(ct);
        }
        // The leading system and the figure it leads on, side by side. Reporting a model
        // without the number it earned is the loose framing this page is meant to avoid.
        if (c.model || c.stat) {
          const line = el('div', 'fw-col-line');
          if (c.model) {
            const m = el('div', 'fw-col-model');
            m.innerHTML = vendorMark(c.model);
            const mt = el('span', '');
            mt.textContent = c.model;
            m.appendChild(mt);
            line.appendChild(m);
          }
          if (c.stat) {
            const st = el('div', 'fw-col-stat');
            const sv = el('strong', '');
            sv.textContent = c.stat[0];
            const sl = el('span', '');
            sl.textContent = c.stat[1];
            st.append(sv, sl);
            line.appendChild(st);
          }
          col.appendChild(line);
        }
        const cb = el('p', 'fw-col-body');
        cb.textContent = c.body || '';
        col.appendChild(cb);
        pw.appendChild(col);
      });
      p.appendChild(pw);
    }
    // Individual scored runs, drawn from the corpus. `stats` is supplied per card rather
    // than computed from a fixed triple: the runs do not all report the same quantities,
    // and inventing the missing ones to fill a column is how a figure stops being evidence.
    if (s.cases && s.cases.length) {
      if (s.casesLabel) {
        const cl = el('div', 'fw-cases-label');
        cl.textContent = s.casesLabel;
        p.appendChild(cl);
      }
      const grid = el('div', 'fw-cases');
      s.cases.forEach((cs) => {
        const card = el('article', 'fw-case is-' + cs.outcome);
        card.dataset.at = String(cs.at);
        const head = el('div', 'fw-case-head');
        const cond = el('span', 'fw-case-cond');
        cond.textContent = cs.cond;
        const verdict = el('span', 'fw-case-verdict');
        verdict.textContent = cs.verdict || (cs.outcome === 'ok' ? 'Arrived' : 'Not arrived');
        head.append(cond, verdict);
        const mod = el('div', 'fw-case-model');
        mod.innerHTML = vendorMark(cs.agent);
        const mt = el('span', '');
        mt.textContent = cs.agent;
        mod.appendChild(mt);
        const nums = el('div', 'fw-case-nums');
        (cs.stats || []).forEach(([v, l]) => {
          const cell = el('div', 'fw-case-num');
          const big = el('strong', '');
          big.textContent = v;
          const cap = el('span', '');
          cap.textContent = l;
          cell.append(big, cap);
          nums.appendChild(cell);
        });
        card.append(head, mod, nums);
        if (cs.note) {
          const n = el('p', 'fw-case-note');
          n.textContent = cs.note;
          card.appendChild(n);
        }
        grid.appendChild(card);
      });
      if (s.cardsLede) {
        const le = el('p', 'fw-cards-lede');
        le.textContent = s.cardsLede;
        p.appendChild(le);
      }
      p.appendChild(grid);
      // Nine here, eleven in the corpus. Stating the difference is what stops the two
      // navigation-only shapes reading as an inconsistency.
      if (s.cardsFoot) {
        const fo = el('p', 'fw-cards-foot');
        fo.textContent = s.cardsFoot;
        p.appendChild(fo);
      }
    }
    // The results table. Deliberately narrow: one column per pillar plus reliability, which
    // is the fewest columns that still shows a different system winning each one.
    if (s.metrics) {
      const M = s.metrics;
      const tbl = el('table', 'fw-metrics');
      if (M.caption) {
        const cp = el('caption', '');
        cp.textContent = M.caption;
        tbl.appendChild(cp);
      }
      const thead = el('thead', '');
      const hr = el('tr', '');
      const corner = el('th', 'fw-m-sys');
      corner.scope = 'col';
      corner.textContent = M.rowHead || 'System';
      hr.appendChild(corner);
      M.cols.forEach((c) => {
        const th = el('th', '');
        th.scope = 'col';
        th.textContent = c;
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      // Best per column, found rather than hand-marked, so a corrected number can never
      // leave the bold on the wrong row. `best` per column is a direction, not an assumption:
      // this suite contains lower-is-better columns too (over-effort ratio, under-effort
      // share), and a silent max would bold the worst system in one of those. Non-numeric
      // cells are filtered rather than fed to Math.max, which would return NaN and unbold
      // the entire column with no sign that anything went wrong.
      const dirs = M.best || M.cols.map(() => 'high');
      const best = M.cols.map((_, j) => {
        const nums = M.rows.map((r) => parseFloat(r.vals[j])).filter(Number.isFinite);
        if (!nums.length) return null;
        return dirs[j] === 'low' ? Math.min(...nums) : Math.max(...nums);
      });
      const tb = el('tbody', '');
      M.rows.forEach((r) => {
        const tr = el('tr', '');
        const th = el('th', 'fw-m-sys');
        th.scope = 'row';
        // The flex row lives on an inner span, never on the <th>. Flexing the cell itself
        // takes it out of the table formatting context, so the browser wraps it in an
        // anonymous cell and the row rule and padding paint on the wrong box.
        const nm = el('span', 'fw-m-sysin');
        nm.innerHTML = vendorMark(r.system);
        const nmt = el('span', '');
        nmt.textContent = r.system;
        nm.appendChild(nmt);
        th.appendChild(nm);
        tr.appendChild(th);
        r.vals.forEach((v, j) => {
          const td = el('td', (best[j] !== null && parseFloat(v) === best[j]) ? 'is-best' : '');
          td.textContent = v;
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      tbl.append(thead, tb);
      p.appendChild(tbl);
    }
    if (s.tags && s.tags.length) {
      if (s.tagsLabel) {
        const tl = el('div', 'fw-cases-label');
        tl.textContent = s.tagsLabel;
        p.appendChild(tl);
      }
      const tw = el('div', 'fw-tags' + (s.tagsLabel ? ' is-labelled' : ''));
      s.tags.forEach((t) => {
        // A trailing marker denotes a tag that is qualified in the note below, rather than
        // a different kind of thing. Held out of the label so it cannot be read as part of
        // the name, and carried on the element so the styling has something to hook.
        const marked = /\*$/.test(t);
        const c = el('span', 'fw-tag' + (marked ? ' is-marked' : ''));
        c.textContent = marked ? t.slice(0, -1) : t;
        tw.appendChild(c);
      });
      p.appendChild(tw);
    }
    if (s.foot) {
      const f = el('p', 'fw-foot');
      f.textContent = s.foot;
      p.appendChild(f);
    }
    if (s.note) {
      const n = el('p', 'fw-note');
      n.textContent = s.note;
      p.appendChild(n);
    }
    if (s.cta) {
      const cw = el('div', 'fw-cta');
      (s.cta || []).forEach((c, i) => {
        const a = el('a', i === 0 ? 'fw-btn fw-btn-primary' : 'fw-btn');
        a.href = c.href;
        a.textContent = c.label;
        cw.appendChild(a);
      });
      p.appendChild(cw);
    }
    // The onward link, held back at the top of this function on a full-width band so it
    // lands after the band's own content rather than before it.
    if (nextCard) p.appendChild(nextCard);
    // A table stacked under prose is the single tallest thing this page can produce, and on
    // the stacked shell panel height is taken straight out of the film. Set beside the prose
    // instead it costs nothing: measured at 1560x900 the results panel drops from 1106px to
    // roughly a third of that, and the film keeps its size.
    //
    // This runs LAST, after every other block exists. Wrapping earlier left the tags, note
    // and call-to-action as direct children of a grid, where they auto-placed into row two
    // rather than flowing under the prose.
    if (s.metrics) {
      const tbl = p.querySelector('.fw-metrics');
      const main = el('div', 'fw-panel-main');
      Array.from(p.childNodes).forEach((n) => { if (n !== tbl) main.appendChild(n); });
      p.append(main, tbl);          // tbl is already a child; append moves it to the end
      p.classList.add('fw-panel-metrics');
    }
    copyWrap.appendChild(p);
    return p;
  }
  const panels = S.map((s, i) => {
    try {
      return buildPanel(s, i);
    } catch (e) {
      console.error('flight: section ' + i + ' (' + (s.id || s.label || '?')
        + ') failed to build:', e);
      const p = el('article', 'fw-panel');
      if (s.id) p.id = s.id;
      p.style.setProperty('--accent', s.accent || 'var(--pillar-agentic)');
      const h = el('h2', 'fw-title');
      h.textContent = s.title || (s.mark && s.mark.name) || s.label || 'Section ' + (i + 1);
      const b = el('p', 'fw-body');
      b.textContent = 'This section did not render.';
      p.append(h, b);
      copyWrap.appendChild(p);
      return p;
    }
  });
  stage.append(copyWrap, status);

  // Route rail. Clicking a stop scrolls to it, which is the only navigation a
  // scroll page can offer that does not fight the scroll itself.
  const rail = el('nav', 'fw-rail');
  rail.setAttribute('aria-label', 'Flight route');
  // A column of unlabelled dots is a slide-deck affordance. A research page is read by
  // scrolling and navigated by a named bar across the top, so the dots come out wherever
  // that bar is present.
  if (config.rail === false) rail.hidden = true;
  const dots = S.map((s, i) => {
    const b = el('button', 'fw-dot');
    b.type = 'button';
    b.innerHTML = '<span class="fw-dot-mark"></span><span class="fw-dot-label"></span>';
    b.querySelector('.fw-dot-label').textContent = s.label;
    b.addEventListener('click', () => {
      window.scrollTo({ top: landingPx(i), behavior: reduce ? 'instant' : 'smooth' });
      // Wait for the panel to become operable rather than guessing at 600ms. Over a long
      // jump it is still inert at that point, and focus() on an inert element is a silent
      // no-op - the reader gets a scroll, no focus move and no announcement.
      const p = panels[i];
      p.tabIndex = -1;
      let tries = 0;
      (function land() {
        if (!p.inert) { p.focus({ preventScroll: true }); return; }
        if (++tries < 90) requestAnimationFrame(land);
      })();
    });
    rail.appendChild(b);
    return b;
  });
  stage.appendChild(rail);

  // Persistent index of every world. The film can only hold one or two globes at a time,
  // so on its own it keeps five of the six off screen at any moment and the set never reads
  // as a set. These stay up the whole way down, dimmed, and light up when the flight
  // reaches them - so "six worlds" is visible rather than merely claimed.
  const globes = (config.globes || []).map((g) => {
    // Both of these failed silently before: an out-of-range index made centrePx return
    // undefined so the click did nothing, and a stop that arrived as a string from JSON
    // never matched the strict compare in paintCopy, so that world never lit up.
    const stopIdx = Number(g.stop);
    if (!Number.isInteger(stopIdx) || stopIdx < 0 || stopIdx >= N) {
      console.warn('flight: globe "' + g.label + '" has stop ' + JSON.stringify(g.stop) +
                   ', which is not a section index in 0..' + (N - 1));
    }
    const b = el('button', 'fw-globe');
    b.type = 'button';
    b.title = g.label;
    const im = artImg(g.src, '', 'fw-globe-img');   // the label below is the accessible name
    const cap = el('span', 'fw-globe-label');
    cap.textContent = g.label;
    b.append(im, cap);
    b.addEventListener('click', () => {
      const c = centrePx(stopIdx);
      if (Number.isFinite(c)) {
        window.scrollTo({ top: landingPx(stopIdx), behavior: reduce ? 'instant' : 'smooth' });
      }
    });
    b.__stop = stopIdx;
    return b;
  });
  if (globes.length) {
    const strip = el('nav', 'fw-globes');
    strip.setAttribute('aria-label', 'The six worlds');
    globes.forEach((b) => strip.appendChild(b));
    stage.appendChild(strip);
  }

  /* The section bar.
     ---------------------------------------------------------------------------
     Named sections across the top, in a bar, the way a paper's own project page is
     navigated. It is not a second timeline: each entry is one of the same stops the flight
     already has, so clicking one flies there exactly as a rail dot did, and the entry that
     lights is whichever section CONTAINS the live stop rather than whichever was clicked -
     so it stays right when the reader scrolls instead of clicking. */
  /* The bar spans three pages now, so an entry is either a scroll on THIS page or a link
     to another one. A link is a real anchor, not a button with a click handler: it has to
     open in a new tab on middle click, show its target in the status bar, and work with
     JavaScript broken - all of which a button silently does not do. */
  const navItems = (config.nav || []).map((n) => {
    if (n.href) {
      const a = el('a', 'fw-nav-item');
      a.href = n.href;
      a.textContent = n.label;
      a.__from = -1;
      a.__to = -1;
      if (n.here) a.setAttribute('aria-current', 'page');
      return a;
    }
    const from = S.findIndex((x) => x.id === n.at);
    const to = n.to ? S.findIndex((x) => x.id === n.to) : from;
    const b = el('button', 'fw-nav-item');
    b.type = 'button';
    b.textContent = n.label;
    if (from < 0) {
      console.warn('flight: nav entry "' + n.label + '" points at section "' + n.at +
                   '", which does not exist');
    }
    b.addEventListener('click', () => {
      const c = centrePx(from);
      if (Number.isFinite(c)) {
        window.scrollTo({ top: landingPx(from), behavior: reduce ? 'instant' : 'smooth' });
      }
    });
    b.__from = from;
    b.__to = to < 0 ? from : to;
    return b;
  });
  if (navItems.length) {
    const bar = el('nav', 'fw-nav');
    bar.setAttribute('aria-label', 'Sections');
    navItems.forEach((b) => bar.appendChild(b));
    const host = document.querySelector('[data-nav-host]') || stage;
    host.appendChild(bar);
  }

  const hint = el('div', 'fw-hint');
  hint.textContent = config.hint || 'scroll to fly in';
  stage.appendChild(hint);

  /* STEP CONTROLS.
     ---------------------------------------------------------------------------
     Two buttons that move the reader exactly one stop, forward or back.

     A scroll flight has one property a normal page does not: there are RIGHT places to
     stop. Every section's copy is fully lit only at its band centre, and a reader landing
     anywhere else is reading through a dissolve. Wheel and trackpad cannot hit those
     centres, and on a page that runs to 47 viewport heights a reader who wants the next
     section has to hunt for it. So the target is the band centre itself, not a viewport of
     travel: pressing down always lands somewhere the page is meant to be looked at.

     Deliberately NOT a scroll hijack. Nothing here listens to wheel or touch; the buttons
     issue an ordinary scrollTo and the flight paints from the scroll position exactly as it
     does for a drag. Native scrolling stays native. */
  const stepBar = el('div', 'fw-step');
  const stepUp = el('button', 'fw-step-btn is-up');
  const stepDown = el('button', 'fw-step-btn is-down');
  const CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9l7 7 7-7" '
    + 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" '
    + 'stroke-linejoin="round"/></svg>';
  [stepUp, stepDown].forEach((b) => { b.type = 'button'; b.innerHTML = CHEV; });
  stepUp.setAttribute('aria-label', 'Previous section');
  stepDown.setAttribute('aria-label', 'Next section');
  const stepNow = el('span', 'fw-step-now');
  stepNow.setAttribute('aria-hidden', 'true');
  stepBar.append(stepUp, stepNow, stepDown);

  /* Where the buttons can land. The opening is a block in normal flow rather than a stop,
     so it is not in `centres` - but it is the first screen a reader sees, and pressing up
     from the first stop has to return to it rather than to a scroll position that merely
     looks like the top. Hence target 0 is the document top whenever there is an opening. */
  function stepTargets() {
    const t = S.map((s, i) => landingPx(i));
    return openEl ? [0].concat(t) : t;
  }
  /* Which stop the reader is ON, for the readout and the disabled states: the nearest
     target, so drifting a little past a centre still reads as being in that section. */
  const STEP_EPS = 24;                    // px of slack; smooth scrolling never lands exact
  function stepIndex(targets) {
    const y = window.scrollY || window.pageYOffset || 0;
    let best = 0, bestD = Infinity;
    targets.forEach((t, i) => {
      const dd = Math.abs(t - y);
      if (dd < bestD) { bestD = dd; best = i; }
    });
    return best;
  }
  /* Where a press GOES, which is a different question. Not "nearest plus one": on a page
     with no opening block the reader starts at y = 0, which is thousands of pixels above
     the first stop, and nearest-plus-one skipped that stop entirely - the first press of
     down landed on the SECOND section. The honest rule is directional: go to the first
     target strictly beyond where the reader is. */
  /* Where the last press is heading, until the scroll gets there.
     A smooth scroll takes a few hundred milliseconds, and during it window.scrollY is an
     intermediate value. Asking it "what is the next stop" mid-flight answers with the one
     already being travelled to, so a reader pressing down twice quickly moved one section
     and then nudged a few pixels. Pressing ahead of the animation is the normal way people
     use a control like this, so the pending target - not the live position - is what the
     next press steps from. */
  let stepPend = null;
  let stepPendT = 0;
  function stepFrom() {
    const y = window.scrollY || window.pageYOffset || 0;
    // The latch expires: if the scroll never arrives (the reader grabbed the page mid-way,
    // or the target moved under a resize) the live position must take over again.
    if (stepPend == null || Date.now() - stepPendT > 1200) return y;
    if (Math.abs(y - stepPend) < 4) { stepPend = null; return y; }
    return stepPend;
  }
  function stepNext(targets, dir) {
    const y = stepFrom();
    if (dir > 0) {
      for (let i = 0; i < targets.length; i++) if (targets[i] > y + STEP_EPS) return i;
      return -1;
    }
    for (let i = targets.length - 1; i >= 0; i--) if (targets[i] < y - STEP_EPS) return i;
    return -1;
  }
  function stepGo(dir) {
    const targets = stepTargets();
    const to = stepNext(targets, dir);
    if (to < 0) return;
    stepPend = targets[to];
    stepPendT = Date.now();
    window.scrollTo({ top: targets[to], behavior: reduce ? 'instant' : 'smooth' });
    // The live region already announces each section as it settles, so this does not
    // duplicate it; what it does is move focus somewhere real, because a button that
    // disables itself under the reader's finger otherwise drops focus to <body>.
    if (to === targets.length - 1 && document.activeElement === stepDown) stepUp.focus();
    if (to === 0 && document.activeElement === stepUp && !openEl) stepDown.focus();
  }
  stepUp.addEventListener('click', () => stepGo(-1));
  stepDown.addEventListener('click', () => stepGo(1));
  function stepSync() {
    const targets = stepTargets();
    const at = stepIndex(targets);
    // Disabled when there is genuinely nowhere to go in that direction, asked of the same
    // function that does the going - so a button is never live with nothing behind it.
    const y = window.scrollY || window.pageYOffset || 0;
    stepUp.disabled = !targets.some((t) => t < y - STEP_EPS);
    stepDown.disabled = !targets.some((t) => t > y + STEP_EPS);
    stepNow.textContent = (at + 1) + '/' + targets.length;
  }
  stage.appendChild(stepBar);

  /* THE OPENING.
     ---------------------------------------------------------------------------
     A block in NORMAL FLOW, above the stage, one viewport tall. Not a stop.
     A stop is pinned and cross-fades, which is right for the flight and wrong for a title
     page: a reader scrolling down expects the first screen to travel up and off, taking
     its own content with it, not to dissolve in place while the words hold still. So this
     is not in the sections list at all - it is a section of the document, and the flight
     begins underneath it. `measure()` adds its height to the lead, which is what keeps
     every stop's geometry correct below it. */
  /* THE THREE-BY-THREE GRID, built in one place.
     ---------------------------------------------------------------------------------
     The overview's whole argument is this grid: the corpus, the six worlds, the eleven
     types and the three pillar headlines, with the mark in the middle cell. It was an
     opening-only feature, so it could only ever be the FIRST screen of a page. Extracted
     so a stop can carry it too, which is what lets the Experience page end on it instead
     of sending the reader to a separate page for it. */
  function buildCells(O) {
  const g = el('div', 'fw-open-grid');
  const cell = (cls) => { const c = el('div', 'fw-open-cell ' + cls); g.appendChild(c); return c; };
  (O.cells || []).forEach((c, k) => {
    // The mark is the middle cell of the three by three, so it is inserted at index 4.
    if (k === 4) {
      const mid = cell('is-mark');
      if (O.mark) mid.appendChild(artImg(O.mark, O.markAlt || '', 'fw-open-mark'));
    }
    const box = cell(c.wide ? 'is-wide' : '');
    if (c.label) {
      const l = el('div', 'fw-open-lab');
      l.textContent = c.label;
      box.appendChild(l);
    }
    if (c.text) {
      const t = el('p', 'fw-open-text');
      t.textContent = c.text;
      box.appendChild(t);
    }
    /* Figures. Where a tile also carries a ring, they run as a STRIP across the top -
       numeral over label, three abreast - so the tile reads as one thing: four numbers
       and the shape they divide into. Stacked as rows they were a list sitting above an
       unrelated chart. */
    if ((c.items || []).length) {
      const strip = el('div', 'fw-open-stats' + (c.ring ? ' is-strip' : ''));
      c.items.forEach((it) => {
        const row = el('div', 'fw-open-i');
        const a = el('b', '');
        a.textContent = it[0];
        const b = el('span', '');
        b.textContent = it[1] || '';
        row.append(a, b);
        strip.appendChild(row);
      });
      box.appendChild(strip);
    }
    if (c.chips) {
      const cw = el('div', 'fw-open-chips');
      c.chips.forEach((x) => {
        const ch = el('span', 'fw-open-chip');
        ch.textContent = x;
        cw.appendChild(ch);
      });
      box.appendChild(cw);
    }
    /* Conversations by world, as a ring.
       -----------------------------------------------------------------------------
       Six slices and no legend: a legend would make this eleven lookups, and the whole
       finding is a shape - five equal worlds and one smaller. Sorted largest first
       clockwise from twelve, with Pathfinding last because it is the one that differs.
       One hue: the slices are worlds, and on this page colour means a system. */
    /* Which system holds each pillar. Three rows, each naming a pillar, its number and
       the system that leads it - the three plots on this screen, said once in words. */
    if (c.leads) {
      const wrap = el('div', 'fw-leads');
      c.leads.forEach(([pillar, metric, who]) => {
        const row = el('div', 'fw-lead');
        row.style.setProperty('--sys', sysColor(who));
        const p1 = el('span', 'fw-lead-pillar');
        p1.textContent = pillar;
        const m1 = el('b', 'fw-lead-metric');
        m1.textContent = metric;
        const w1 = el('span', 'fw-lead-who');
        w1.innerHTML = vendorMark(who);
        const wn = el('span', '');
        wn.textContent = who;
        w1.appendChild(wn);
        row.append(p1, m1, w1);
        wrap.appendChild(row);
      });
      box.appendChild(wrap);
    }
    if (c.ring) box.appendChild(buildRing(c.ring));
    if (c.figure) {
      const im = artImg(c.figure, c.figureAlt || '', 'fw-open-fig');
      box.appendChild(im);
    }
    if (c.worlds) box.appendChild(buildWorlds(c.worlds));
    /* The headline: the number, and which system holds it. Three of these across the
       bottom row are the paper's thesis - a different system leads each pillar - and
       without the name the reader has to read three charts to find that out. */
    if (c.head) {
      const hd = el('div', 'fw-open-head');
      const v = el('div', 'fw-open-headv');
      v.textContent = c.head.v;
      const w = el('div', 'fw-open-headw');
      w.innerHTML = vendorMark(c.head.who);
      const nm = el('span', '');
      nm.textContent = c.head.who;
      w.appendChild(nm);
      w.style.setProperty('--sys', sysColor(c.head.who));
      hd.append(v, w);
      box.appendChild(hd);
    }
    if (c.plot) {
      const P = c.plot;
      box.classList.add('is-plot');
      box.style.setProperty('--tint', P.accent || 'var(--magenta)');
      /* HORIZONTAL bars, direct labelled, with the paper's interval on every one.
         -------------------------------------------------------------------------
         These were vertical columns with the five system names rotated 45 degrees and
         truncated from the front, which is worse than no label: "...altime-2.1-mini"
         names nothing. Five ranked categories with long names is exactly the case a
         horizontal bar chart exists for - the name sits flush left, at full length,
         unrotated. The interval is drawn because the paper never states one of these
         numbers without it, and a bare bar claims a precision the study does not. */
      const rws = P.rows.slice().sort((a, b) => b[1] - a[1]);
      const base = Number.isFinite(P.base) ? P.base : 0;
      const reach = Math.max(...rws.map((r) => r[1] + (r[2] || 0)));
      const top = Math.max(Number.isFinite(P.max) ? P.max : 0, reach);
      const span = Math.max(1e-6, top - base);
      const dp = P.dp === undefined ? 3 : P.dp;
      const pc = (x) => (100 * Math.max(0, Math.min(1, (x - base) / span))).toFixed(2) + '%';
      const rowsEl = el('div', 'fw-open-hrows');
      rws.forEach(([nm, v, pm]) => {
        const r = el('div', 'fw-open-hrow');
        r.style.setProperty('--sys', sysColor(nm));
        const lab = el('div', 'fw-open-hname');
        lab.innerHTML = vendorMark(nm);
        const nt = el('span', '');
        nt.textContent = (P.short && P.short[nm]) || nm;
        lab.appendChild(nt);
        const track = el('div', 'fw-open-htrack');
        const bar = el('div', 'fw-open-hbar');
        bar.style.width = pc(v);
        track.appendChild(bar);
        // The interval, drawn to scale. Nova's 0.011 is a three pixel bar by the
        // stylesheet's floor, so without this it reads as missing data.
        if (pm) {
          const ci = el('div', 'fw-open-hci');
          ci.style.left = pc(Math.max(base, v - pm));
          ci.style.width = pc(Math.min(top, v + pm)) === ci.style.left ? '2px'
            : (100 * (Math.min(top, v + pm) - Math.max(base, v - pm)) / span).toFixed(2) + '%';
          track.appendChild(ci);
        }
        const val = el('div', 'fw-open-hval');
        val.textContent = v.toFixed(dp);
        if (pm) {
          const s = el('span', 'fw-open-hpm');
          s.textContent = '\u00b1' + pm.toFixed(3).replace(/^0/, '');
          val.appendChild(s);
        }
        r.append(lab, track, val);
        rowsEl.appendChild(r);
      });
      box.appendChild(rowsEl);
      if (P.note) {
        const nt = el('div', 'fw-open-pnote');
        nt.textContent = P.note;
        box.appendChild(nt);
      }
    }
  });
    return g;
  }

  /* THE CORPUS RING and THE SIX GLOBES, built in one place.
     ---------------------------------------------------------------------------------
     Both began as opening-CELL features, which is why they only ever appeared on
     overview.html: index.html has no opening block at all. Extracted so a flight stop can
     carry either one, and so the two pages draw the identical figure from the identical
     code rather than a second version of it that can drift. */
  function buildRing(R) {
      // Keyed off the world's own name so the config stays a plain list of pairs and the
      // colours live in the sheet with the rest of the palette.
      let holderLabel = '';
      const wcol = (nm) => 'var(--world-' + String(nm).toLowerCase().replace(/[^a-z]/g, '')
        + ', var(--ink))';
      const total = R.slices.reduce((a, s) => a + s[1], 0);
      const wrap = el('div', 'fw-ring');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('class', 'fw-ring-svg');
      const C = 50, r = 38, circ = 2 * Math.PI * r;
      let acc = 0;
      R.slices.forEach(([nm, v], k) => {
        const seg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        seg.setAttribute('cx', C); seg.setAttribute('cy', C); seg.setAttribute('r', r);
        seg.setAttribute('fill', 'none');
        seg.setAttribute('stroke-width', 13);
        // A hairline gap so six slices read as six, without a second colour.
        const len = circ * v / total;
        seg.setAttribute('stroke-dasharray', Math.max(0, len - 1.2) + ' ' + (circ - len + 1.2));
        seg.setAttribute('stroke-dashoffset', -circ * acc / total);
        seg.setAttribute('transform', 'rotate(-90 50 50)');
        seg.setAttribute('class', 'fw-ring-seg');
        seg.style.setProperty('--wc', wcol(nm));
        const ti = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        ti.textContent = nm + ': ' + v + ' conversations, '
          + (100 * v / total).toFixed(1) + '% of the corpus';
        seg.appendChild(ti);
        svg.appendChild(seg);
        acc += v;
      });
      wrap.appendChild(svg);
      const mid = el('div', 'fw-ring-mid');
      const mv = el('b', '');
      mv.textContent = R.centre;
      const ms = el('span', '');
      ms.textContent = R.centreSub || '';
      mid.append(mv, ms);
      wrap.appendChild(mid);
      // Direct labels, laid around the ring rather than in a legend.
      const key = el('div', 'fw-ring-key');
      if (R.keyHead) {
        const kh = el('div', 'fw-ring-khead');
        kh.textContent = R.keyHead;
        key.appendChild(kh);
      }
      R.slices.forEach(([nm, v]) => {
        const row = el('div', 'fw-ring-krow');
        const sw = el('span', 'fw-ring-sw');
        sw.style.setProperty('--wc', wcol(nm));
        sw.setAttribute('aria-hidden', 'true');
        const n = el('span', 'fw-ring-kname');
        n.textContent = nm;
        row.append(sw, n);
        // The figure is off the face of the chart now, so it has to stay reachable.
        row.title = nm + ': ' + v + ' conversations, '
          + (100 * v / total).toFixed(1) + '% of the corpus';
        key.appendChild(row);
      });
      /* Colour is now the only thing tying a legend row to its slice, so the numbers have
         to survive somewhere a screen reader and a colour-blind reader can both reach.
         This is that place. */
      holderLabel = (R.keyHead || 'Conversations by world') + '. '
        + R.slices.map(([nm, v]) => nm + ' ' + v).join(', ')
        + '. ' + R.centre + ' ' + (R.centreSub || '') + '.';
      const holder = el('div', 'fw-ring-wrap');
      holder.append(wrap, key);
      holder.setAttribute('role', 'img');
      holder.setAttribute('aria-label', holderLabel);
      return holder;
  }

  function buildWorlds(list) {
    const ww = el('div', 'fw-open-worlds');
    (list || []).forEach(([nm, src]) => {
      const w = el('div', 'fw-open-w');
      w.appendChild(artImg(src, '', 'fw-open-wimg'));
      const l = el('span', '');
      l.textContent = nm;
      w.appendChild(l);
      ww.appendChild(w);
    });
    return ww;
  }

  /* THE BYLINE, built in one place.
     ---------------------------------------------------------------------------------
     Two callers now want it: the opening block, which is where a paper puts authorship,
     and any stop that sets `byline: true`, which is how index.html carries it without
     growing a whole title screen. Built here rather than twice so the two cannot drift.

     Read from a global rather than from a page config on purpose. The page's default
     state is ANONYMOUS: with nothing set this returns null and nothing is rendered, so a
     build cannot acquire a byline by accident. The public build injects the global, which
     is the same mechanism and the same safety property the outbound links had. */
  function buildByline() {
    const A = window.__DW_AUTHORS;
    if (!A || !A.people || !A.people.length) return null;
    const by = el('div', 'fw-open-by');
    const line = el('div', 'fw-open-authors');
    A.people.forEach((p, k) => {
      const s = el('span', 'fw-open-author');
      const nm = el('b', '');
      nm.textContent = p.name;
      s.appendChild(nm);
      if (p.sup) {
        const sup = el('sup', '');
        sup.textContent = p.sup;
        s.appendChild(sup);
      }
      line.appendChild(s);
      if (k < A.people.length - 1) {
        const sep = el('span', 'fw-open-sep');
        sep.textContent = ',';
        line.appendChild(sep);
      }
    });
    by.appendChild(line);
    /* Three rows, not one wrapping soup.
       -------------------------------------------------------------------------------
       Flowed as a single wrap row, the affiliations, the contact and the two notes
       packed themselves wherever they fitted: the notes ended up hard against the right
       edge of the screen, a column away from the names they annotate, and the monospace
       address sat on a different baseline from the links beside it. Grouped, each row
       is one kind of thing and they share a baseline. */
    const affRow = el('div', 'fw-open-affrow');
    const noteRow = el('div', 'fw-open-notes');
    (A.affiliations || []).forEach((af) => {
      const r = el('div', 'fw-open-aff');
      const sup = el('sup', '');
      sup.textContent = af.sup || '';
      r.appendChild(sup);
      // A link when there is one, plain text when there is not: the anonymous build
      // never gets here, so an outbound href on this line is safe by construction.
      if (af.href) {
        const a = el('a', 'fw-open-afflink');
        a.href = af.href;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = af.name;
        r.appendChild(a);
      } else {
        const sp = el('span', '');
        sp.textContent = af.name;
        r.appendChild(sp);
      }
      affRow.appendChild(r);
    });
    if (A.email) {
      const e = el('span', 'fw-open-mail');
      e.textContent = A.email;
      affRow.appendChild(e);
    }
    (A.notes || []).forEach((nt) => {
      const d = el('span', 'fw-open-note');
      d.textContent = nt;
      noteRow.appendChild(d);
    });
    if (affRow.children.length) by.appendChild(affRow);
    if (noteRow.children.length) by.appendChild(noteRow);
    /* The paper buttons, last, under the notes. Read from their own global for the same
       reason the names are: the anonymous build is never handed one, so it cannot grow an
       outbound link by accident. An <a> rather than a button, because it is a navigation
       the reader may well want to open in a new tab. */
    const P = window.__DW_PAPER;
    if (P && P.length) {
      const row = el('div', 'fw-open-links');
      P.forEach((lk) => {
        if (!lk || !lk.href) return;
        const a = el('a', 'fw-paperbtn is-' + (lk.kind || 'link'));
        a.href = lk.href;
        a.target = '_blank';
        a.rel = 'noopener';
        // A document mark, drawn rather than fetched: the page ships no icon font and an
        // <img> here would be a request for 300 bytes of glyph.
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('class', 'fw-paperbtn-i');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('aria-hidden', 'true');
        const pth = document.createElementNS(NS, 'path');
        pth.setAttribute('d', 'M4 1.5h5L12.5 5v9.5h-8.5z');
        pth.setAttribute('fill', 'none');
        pth.setAttribute('stroke', 'currentColor');
        pth.setAttribute('stroke-width', '1.3');
        pth.setAttribute('stroke-linejoin', 'round');
        const fold = document.createElementNS(NS, 'path');
        fold.setAttribute('d', 'M9 1.5V5h3.5');
        fold.setAttribute('fill', 'none');
        fold.setAttribute('stroke', 'currentColor');
        fold.setAttribute('stroke-width', '1.3');
        fold.setAttribute('stroke-linejoin', 'round');
        svg.append(pth, fold);
        const t = el('span', 'fw-paperbtn-t');
        t.textContent = lk.label || 'Paper';
        a.append(svg, t);
        row.appendChild(a);
      });
      if (row.children.length) by.appendChild(row);
    }
    return by;
  }

  let openEl = null;
  if (config.opening) {
    const O = config.opening;
    openEl = el('section', 'fw-open');
    const inner = el('div', 'fw-open-in');
    if (O.title) {
      const h = el('h1', 'fw-open-title');
      h.textContent = O.title;
      inner.appendChild(h);
    }
    /* Authorship, under the title, where a paper puts it. Built by buildByline() so this
       and any stop carrying `byline: true` render the identical thing. */
    const openBy = buildByline();
    if (openBy) inner.appendChild(openBy);
    const g = buildCells(O);
    inner.appendChild(g);
    openEl.appendChild(inner);
    root.appendChild(openEl);
  }

  const spacer = el('div', 'fw-spacer');
  root.append(stage, spacer);

  // ---------------------------------------------------------------- the walks
  /* Six recorded conversations, replayed live inside the page.
     ------------------------------------------------------------------------
     `walkmap.js` already does all of this: renderGeoDemo({GEO, host, compact}) is the same
     instance the demo gallery runs, looping, and it hands back a `destroy()` and a read-only
     `probe`. Nothing here re-implements a map. What this section owns is the three things a
     scroll page adds on top:

       - WHEN a payload is fetched. Six walks are ~410 KB, which is not much next to the film
         but is entirely wasted on a reader who never reaches the Pathfinding stop.
       - WHICH tiles are alive. Each one is a rAF loop with a resize observer; six of them
         running behind a 1080p scrub is a measurable frame cost, and they are off screen for
         most of the page. They are built on approach and torn down on departure.
       - What a click does. The tile is deliberately the compact dress with no controls; the
         overlay is the SAME renderer without `compact`, which is where the step bar lives.
         So "play the route one block at a time" is the renderer's own transport, not a
         second implementation that could disagree with it.

     No audio anywhere on this path. The recordings are megabytes each and the tiles loop
     silently by design, so `setVoice` is never called and no *_voice.json is ever fetched. */
  const MAPS = config.maps || {};
  const mapPayloads = {};             // key -> parsed payload, fetched once
  const mapLive = {};                 // key -> the live compact instance
  let mapsFetch = null;

  function mapsReady() {
    if (mapsFetch) return mapsFetch;
    // Every walk this page can show, from BOTH sources. The list used to come only from
    // the walks stop, so on a page that has recordings but no walks stop - which is what
    // the samples page is - the two Pathfinding tiles asked for payloads nobody had
    // fetched and sat on "loading" forever.
    const keys = [];
    mapStops.forEach((ms) => (ms.cfg.cells || []).forEach((c) => keys.push(c.key)));
    runStops.forEach((rs) => (rs.cfg || []).forEach((r) => { if (r.map) keys.push(r.map); }));
    // The single-file export inlines the walks here, because a file:// page cannot fetch a
    // sibling - it is a CORS failure, not a 404 - so without this the tiles would sit on
    // their placeholders forever in exactly the copy that gets emailed around.
    const cache = window.__DW_WALKS || null;
    if (cache && keys.every((k) => cache[k])) {
      keys.forEach((k) => { mapPayloads[k] = cache[k]; });
      mapsFetch = Promise.resolve();
      return mapsFetch;
    }
    const base = MAPS.base || '../';
    mapsFetch = Promise.all(keys.map((k) =>
      fetch(base + 'geo_' + k + '.json')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
        .then((j) => { mapPayloads[k] = j; })
        .catch((e) => { console.warn('flight: walk "' + k + '" did not load:', e.message); })));
    return mapsFetch;
  }

  let mapEpoch = 0;
  function mountMaps(stop) {
    if (typeof window.renderGeoDemo !== 'function') return;
    const token = ++mapEpoch;
    mapsReady().then(() => {
      // The payloads can land long after the reader has moved on - a cold, slow connection
      // behind a 39 MB film - and unmountMaps only runs on the NEXT stop change, so six
      // renderers would stay live behind an unrelated stop. Measured cost of that: 1,095
      // setAttribute calls per frame against 17 with them down.
      if (token !== mapEpoch) return;
      mapStops.forEach((ms) => {
        if (ms.i !== stop) return;
        ms.grid.querySelectorAll('.fw-map').forEach((fig) => {
          const key = fig.dataset.key;
          // Keyed by STOP and key, not by key. Two maps stops that show the same walk - the
          // three solved runs appear on both the solved stop and the solved-and-unsolved one
          // - collided in this table: the second stop found the first stop's instance under
          // its own key, decided the tile was already mounted, and left six tiles reading
          // "loading the walk" forever.
          const id = ms.i + '/' + key;
          if (mapLive[id] || !mapPayloads[key]) return;
          const box = fig.querySelector('.fw-map-box');
          box.innerHTML = '';
          mapLive[id] = window.renderGeoDemo({ GEO: mapPayloads[key], host: box, compact: true });
        });
      });
    });
  }

  function unmountMaps(except) {
    mapStops.forEach((ms) => {
      if (ms.i === except) return;
      ms.grid.querySelectorAll('.fw-map').forEach((fig) => {
        const id = ms.i + '/' + fig.dataset.key;
        const inst = mapLive[id];
        if (!inst) return;
        delete mapLive[id];
        try { inst.destroy(); } catch (e) { /* already gone */ }
        const box = fig.querySelector('.fw-map-box');
        const wait = el('div', 'fw-map-wait');
        wait.textContent = 'loading the walk';
        box.appendChild(wait);
      });
    });
  }

  // Built on the APPROACH, not on arrival: a renderer needs a moment to lay itself out, and
  // mounting six of them at the instant the stop lights up puts that work in the same frame
  // as the panel's own fade.
  function mapsOnStopChange(stop) {
    if (!mapStops.length) return;
    /* The stop ITSELF first, and only then the nearest neighbour. `find` returns the first
       match in config order, so with two adjacent maps stops the one before always won:
       standing on the second, the flight mounted the first and unmounted the one on screen.
       Exact match, then nearest, breaks that without changing anything on a page that has
       only one maps stop. */
    const near = mapStops.find((ms) => ms.i === stop)
      || mapStops
        .filter((ms) => Math.abs(ms.i - stop) <= 1)
        .sort((a, b) => Math.abs(a.i - stop) - Math.abs(b.i - stop))[0];
    if (near) mountMaps(near.i);
    unmountMaps(near ? near.i : -1);
  }

  // The full walk, over the page. Same payload, same renderer, without `compact` - which is
  // what brings back the step scrubber, the status line and the legend the tile hides.
  let walkOverlay = null;
  let walkInst = null;
  let walkOpener = null;

  function closeWalk() {
    if (!walkOverlay) return;
    if (walkInst) { try { walkInst.destroy(); } catch (e) { /* gone */ } walkInst = null; }
    walkOverlay.remove();
    walkOverlay = null;
    document.removeEventListener('keydown', onWalkKey, true);
    // Focus goes back where it came from. Dropping it to <body> after a dialog closes leaves
    // a keyboard reader at the top of the document with no announcement.
    if (walkOpener) { try { walkOpener.focus(); } catch (e) { /* detached */ } walkOpener = null; }
  }

  function onWalkKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeWalk(); return; }
    if (e.key !== 'Tab' || !walkOverlay) return;
    // A modal that lets Tab escape into the page behind it is a modal in appearance only.
    const f = walkOverlay.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* Enlarge a figure.
     ---------------------------------------------------------------------------------
     The wide figures - the composition matrix, the duration violins, the small multiples -
     are legible in a band but not comfortable on a laptop: eleven columns and six violins
     want more width than a 1200px container. Clicking one clones it into a full-screen
     panel. A clone rather than a move, so the page behind is untouched and the live
     charts keep their state.

     Escape closes, focus is trapped, and focus returns to whatever opened it - the same
     contract the walk overlay already honours. */
  let zoomEl = null, zoomOpener = null;
  function closeZoom() {
    if (!zoomEl) return;
    zoomEl.remove();
    zoomEl = null;
    document.removeEventListener('keydown', onZoomKey, true);
    if (zoomOpener && zoomOpener.focus) zoomOpener.focus();
    zoomOpener = null;
  }
  function onZoomKey(e) {
    if (!zoomEl) return;
    if (e.key === 'Escape') { e.preventDefault(); closeZoom(); return; }
    if (e.key !== 'Tab') return;
    const f2 = zoomEl.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])');
    if (!f2.length) return;
    const first = f2[0], last = f2[f2.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function openZoom(fig, title) {
    closeZoom();
    zoomOpener = document.activeElement;
    zoomEl = el('div', 'fw-zoom');
    zoomEl.setAttribute('role', 'dialog');
    zoomEl.setAttribute('aria-modal', 'true');
    zoomEl.setAttribute('aria-label', title || 'Enlarged figure');
    const head = el('div', 'fw-zoom-head');
    const h = el('b', '');
    h.textContent = title || '';
    const x = el('button', 'fw-zoom-x');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.innerHTML = '&#10005;';
    x.addEventListener('click', closeZoom);
    head.append(h, x);
    const body = el('div', 'fw-zoom-body');
    const clone = fig.cloneNode(true);
    clone.classList.add('is-zoomed');
    body.appendChild(clone);
    zoomEl.append(head, body);
    zoomEl.addEventListener('click', (e) => { if (e.target === zoomEl) closeZoom(); });
    document.body.appendChild(zoomEl);
    document.addEventListener('keydown', onZoomKey, true);
    x.focus();
  }
  // Every wide figure gets an enlarge control, added after the section is built.
  function addZoom(fig, title) {
    if (!fig) return;
    const b = el('button', 'fw-zoom-btn');
    b.type = 'button';
    b.textContent = 'Enlarge';
    b.setAttribute('aria-label', 'Enlarge: ' + (title || 'figure'));
    b.addEventListener('click', (e) => { e.stopPropagation(); openZoom(fig, title); });
    fig.appendChild(b);
  }

  function openWalk(cell) {
    if (typeof window.renderGeoDemo !== 'function') return;
    // Read BEFORE closing: closeWalk restores focus to the previous opener, so reading it
    // afterwards recorded the wrong element to return to on a second open.
    const opener = document.activeElement;
    closeWalk();
    walkOpener = opener;
    const ov = el('div', 'fw-walk');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', (cell.cond || 'Walk') + ', full size');
    const card = el('div', 'fw-walk-card');
    const head = el('header', 'fw-walk-head');
    const t = el('div', 'fw-walk-title');
    t.textContent = cell.cond || '';
    const sub = el('div', 'fw-walk-sub');
    // Full size, so the sentence the tile had to clamp fits here.
    sub.textContent = [cell.note, cell.detail].filter(Boolean).join(' ');
    const x = el('button', 'fw-walk-x');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.textContent = '×';
    x.addEventListener('click', closeWalk);
    head.append(t, sub, x);
    const body = el('div', 'fw-walk-body');
    card.append(head, body);
    ov.appendChild(card);
    // Clicks on the backdrop close; clicks inside must not, or every interaction with the
    // map dismisses the thing it is inside.
    ov.addEventListener('click', (e) => { if (e.target === ov) closeWalk(); });
    document.body.appendChild(ov);
    walkOverlay = ov;
    document.addEventListener('keydown', onWalkKey, true);
    // Immediately, not inside the payload promise. Focus used to move only on the success
    // branch, so a walk that failed to load left focus on the page BEHIND the dialog and
    // Tab walked straight through it - and even on the happy path there was a window of
    // however long the fetch took.
    x.focus();
    mapsReady().then(() => {
      if (walkOverlay !== ov) return;                 // closed while the payload was in flight
      if (!mapPayloads[cell.key]) {
        body.textContent = 'This walk did not load.';
        return;
      }
      walkInst = window.renderGeoDemo({ GEO: mapPayloads[cell.key], host: body });
      /* And then, if there is a recording of this walk, the rest of the visualizer's view
         of it: the two-lane speech activity timeline, the transcript rail and the call
         transport, all on the recording's own clock. In the OPEN view the renderer lays
         these out beside the map rather than in place of it, which is the whole reason the
         audio moved here from the tile. Fetched on demand: the calls are megabytes and a
         reader who only wanted to see the route never pays for one. */
      if (!cell.voice) return;
      fetch((MAPS.base || '../') + cell.voice)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status))))
        .then((v) => {
          if (walkOverlay !== ov || !walkInst) return;   // closed while it was in flight
          walkInst.setVoice(v);
          // Opened, not started. The reader asked to SEE the walk; the recording is
          // offered by the transport under it, not forced on them.
          walkInst.setVoiceMode(true, { autoplay: false });
        })
        .catch((e) => {
          console.warn('flight: voice for "' + cell.key + '" did not load:', e.message);
        });
    });
  }

  // ------------------------------------------------------- the recorded calls
  /* A transcript window, looping. Two turns visible at a time, advancing on the gap the
     recording itself had between them (compressed, or a six-minute call would take six
     minutes to loop) and starting over at the end.

     No audio. The recordings are megabytes each and the page is silent by design; what is
     being shown is what was said and when, which the transcript carries on its own. */
  const CALLS = config.calls || {};
  const callData = {};
  let callsFetch = null;
  const callTimers = [];

  function callsReady() {
    if (callsFetch) return callsFetch;
    const keys = [];
    runStops.forEach((rs) => rs.cfg.forEach((r) => { if (r.call) keys.push(r.call); }));
    const cache = window.__DW_CALLS || null;
    if (cache && keys.every((k) => cache[k])) {
      keys.forEach((k) => { callData[k] = cache[k]; });
      callsFetch = Promise.resolve();
      return callsFetch;
    }
    const base = CALLS.base || '../';
    callsFetch = Promise.all(keys.map((k) =>
      fetch(base + k + '.json')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
        .then((j) => { callData[k] = j; })
        .catch((e) => { console.warn('flight: call "' + k + '" did not load:', e.message); })));
    return callsFetch;
  }

  function stopCalls() {
    while (callTimers.length) clearTimeout(callTimers.pop());
  }

  /* Which run stop is currently built. Rebuilding one that is already up is not a no-op:
     it wipes the transcript under a recording that is still playing, restarts the looping
     excerpt over the live audio, and - because `__laid` lives on the figure and survives
     the wipe - convinces the new sync closure that the now-empty list is already laid out,
     so the playhead highlight never comes back. The walk tiles have always been guarded
     this way; the call tiles were not, and a single scroll gesture on samples.html (which
     has only two sections, so every stop is "near") was enough to trigger it. */
  let runsLive = -1;

  function mountRuns(stop) {
    if (runsLive === stop) return;
    stopCalls();
    runsLive = stop;
    runStops.forEach((rs) => {
      if (rs.i !== stop) return;
      // The two Pathfinding tiles are the same live renderer the walks stop uses.
      if (typeof window.renderGeoDemo === 'function') {
        mapsReady().then(() => {
          rs.grid.querySelectorAll('.fw-run[data-kind="map"]').forEach((fig) => {
            const k = fig.dataset.key;
            if (mapLive[k] || !mapPayloads[k]) return;
            const box = fig.querySelector('.fw-run-box');
            box.innerHTML = '';
            mapLive[k] = window.renderGeoDemo({ GEO: mapPayloads[k], host: box, compact: true });
          });
        });
      }
      callsReady().then(() => {
        rs.grid.querySelectorAll('.fw-run[data-kind="call"]').forEach((fig) => {
          const d = callData[fig.dataset.call];
          const box = fig.querySelector('.fw-run-box');
          if (!d || !d.utterances) { box.textContent = 'This call did not load.'; return; }
          const from = Number(fig.dataset.from), to = Number(fig.dataset.to);
          const turns = d.utterances.slice(from, to + 1);
          box.innerHTML = '';
          /* The two-lane activity strip, from the call's own lane data.
             ---------------------------------------------------------------------------
             The Pathfinding tiles get this from the walk renderer; the enterprise calls
             had nothing, so the one thing this benchmark is about - who held the channel
             and where the two overlapped - was invisible on five of seven tiles. Drawn
             from `lanes`, which is already in the payload. */
          const L = d.lanes || null;
          if (L && (L.agent || L.user)) {
            const dur = Math.max(
              ...(L.agent || []).map((x) => x[1]),
              ...(L.user || []).map((x) => x[1]), 1);
            const strip = el('div', 'fw-tl');
            strip.setAttribute('aria-hidden', 'true');   // the transcript says it in words
            [['agent', L.agent || []], ['user', L.user || []]].forEach(([who, spans]) => {
              const lane = el('div', 'fw-tl-lane is-' + who);
              spans.forEach(([a, b]) => {
                const seg = el('i', '');
                seg.style.left = (100 * a / dur).toFixed(3) + '%';
                seg.style.width = Math.max(0.35, 100 * (b - a) / dur).toFixed(3) + '%';
                lane.appendChild(seg);
              });
              strip.appendChild(lane);
            });
            // Where the excerpt below sits inside the whole call.
            const win = el('div', 'fw-tl-win');
            const w0 = turns[0] ? turns[0].s : 0;
            const w1 = turns[turns.length - 1] ? turns[turns.length - 1].e : dur;
            win.style.left = (100 * w0 / dur).toFixed(3) + '%';
            win.style.width = Math.max(0.6, 100 * (w1 - w0) / dur).toFixed(3) + '%';
            strip.appendChild(win);
            const head = el('div', 'fw-tl-head');
            strip.appendChild(head);
            fig.__tlHead = head;
            fig.__tlDur = dur;
            box.appendChild(strip);
          }
          const list = el('div', 'fw-turns');
          box.appendChild(list);
          /* Two modes, never at once. Nothing playing: the excerpt loops, which is what
             makes a still tile legible. Playing: every turn in the window is laid out at
             once and the one being spoken is lit, so the reader follows the audio. */
          fig.__sync = (now) => {
            if (!fig.__laid) {
              list.innerHTML = '';
              turns.forEach((t2) => {
                const b = el('div', 'fw-turn is-' + (t2.who === 'agent' ? 'agent' : 'user'));
                const who = el('b', '');
                who.textContent = t2.who === 'agent' ? 'Agent' : 'Caller';
                const tx = el('span', '');
                tx.textContent = String(t2.text).replace(/###STOP###/g, '')
                  .replace(/\u2014|\u2013/g, ' - ').replace(/\s+-\s+/g, ' - ').trim();
                b.append(who, tx);
                b.dataset.s = String(t2.s);
                b.dataset.e = String(t2.e);
                list.appendChild(b);
              });
              fig.__laid = true;
            }
            let live = null;
            [...list.children].forEach((b) => {
              const on = now >= Number(b.dataset.s) && now <= Number(b.dataset.e);
              b.classList.toggle('is-now', on);
              if (on) live = b;
            });
            /* Follow the speech the way the opened call does: SMOOTHLY, and only when the
               live turn actually changes.
               This ran scrollIntoView({block:'nearest'}) unguarded, on every animation
               frame, with no behaviour set. So it re-issued an instant scroll sixty times a
               second and snapped the transcript by a whole line the moment a turn ended,
               which is what made the enterprise tiles read as abrupt beside the Pathfinding
               ones. Scrolling the LIST rather than calling scrollIntoView also keeps the
               page itself still - scrollIntoView will happily scroll an ancestor, and here
               the ancestor is the document. */
            if (live && live !== fig.__lastLive) {
              fig.__lastLive = live;
              const lt = live.offsetTop - list.clientHeight * 0.42;
              list.scrollTo({ top: Math.max(0, lt),
                              behavior: reduce ? 'auto' : 'smooth' });
            }
            if (fig.__tlHead && fig.__tlDur) {
              fig.__tlHead.style.left = (100 * Math.min(1, now / fig.__tlDur)).toFixed(3) + '%';
            }
          };
          let k = 0;
          const step = () => {
            const t = turns[k % turns.length];
            if (k % turns.length === 0) list.innerHTML = '';
            const b = el('div', 'fw-turn is-' + (t.who === 'agent' ? 'agent' : 'user'));
            const who = el('b', '');
            who.textContent = t.who === 'agent' ? 'Agent' : 'Caller';
            const tx = el('span', '');
            // Verbatim words, but the em dash the model emitted is rendered as a single
          // hyphen. It is a punctuation glyph, not a word, and on this page it is also a
          // house rule: a dash is a prosodic break to a speech engine.
          tx.textContent = String(t.text).replace(/###STOP###/g, '')
            .replace(/\u2014|\u2013/g, ' - ').replace(/\s+-\s+/g, ' - ').trim();
            b.append(who, tx);
            list.appendChild(b);
            list.scrollTop = list.scrollHeight;
            k++;
            // The real gap between these two turns, compressed 6x and floored, so the
            // rhythm is the call's own rather than a fixed tick.
            const nxt = turns[k % turns.length];
            const gap = (k % turns.length === 0) ? 2600
              : Math.max(1400, Math.min(4200, ((nxt.s - t.s) || 4) * 1000 / 6 + 1200));
            fig.__loopTimer = setTimeout(step, gap);
            callTimers.push(fig.__loopTimer);
          };
          // Handed to the player so pressing play stops the loop rather than fighting it.
          fig.__stopLoop = () => {
            if (fig.__loopTimer) { clearTimeout(fig.__loopTimer); fig.__loopTimer = null; }
            fig.__looping = false;
          };
          fig.__looping = true;
          step();
        });
      });
    });
  }

  function unmountRuns(except) {
    if (runsLive !== except) runsLive = -1;
    runStops.forEach((rs) => {
      if (rs.i === except) return;
      rs.grid.querySelectorAll('.fw-run').forEach((fig) => {
        // `__laid` is the "playhead mode is built" latch. It lives on the figure, which
        // survives this teardown, so leaving it set makes the next build believe an empty
        // list is already populated.
        fig.__laid = false;
        const k = fig.dataset.key;
        if (k && mapLive[k]) {
          const inst = mapLive[k];
          delete mapLive[k];
          try { inst.destroy(); } catch (e) { /* gone */ }
        }
        const box = fig.querySelector('.fw-run-box');
        if (box) {
          box.innerHTML = '';
          const wait = el('div', 'fw-map-wait');
          wait.textContent = 'loading';
          box.appendChild(wait);
        }
      });
    });
    if (except === -1) stopCalls();
  }

  function runsOnStopChange(stop) {
    if (!runStops.length) return;
    // A recording must not outlive the section that offered it: the panel goes inert and
    // hidden, so the pause button the reader would reach for is no longer on screen.
    const here = runStops.some((rs) => Math.abs(rs.i - stop) <= 1);
    if (!here) {
      document.querySelectorAll('.fw-run audio, .fw-pl audio').forEach((a) => {
        if (!a.paused) a.pause();
      });
    }
    // The stop ITSELF first, then the nearest. `find` returns the first match in config
    // order, so with two adjacent runs stops - Pathfinding, then the enterprise calls - the
    // earlier one always won: standing on the calls stop the flight mounted the walks and
    // left three tiles reading "loading" with nothing to load them.
    const near = runStops.find((rs) => rs.i === stop)
      || runStops
        .filter((rs) => Math.abs(rs.i - stop) <= 1)
        .sort((a, b) => Math.abs(a.i - stop) - Math.abs(b.i - stop))[0];
    unmountRuns(near ? near.i : -1);
    if (near) mountRuns(near.i);
    // The tiles change the panel's height, and the band travel is derived from it.
    measureSpill();
  }

  /* ---------------------------------------------------------------- call tapes
     A recorded enterprise call, drawn the way the live visualizer draws one.
     ---------------------------------------------------------------------------------
     The tile that used to be here showed a two-lane strip and a looping excerpt of the
     transcript. That is the smallest possible view of a full-duplex call, and it left out
     everything the benchmark is actually about: where the two speakers collided, which
     handovers were contested and which failed, where the agent corrected itself, when it
     reached for a tool, and what the harness was doing to the audio at the time.

     This is a port of TimelinePlayer from src/tau2/visualizer/static/js/player.js, cut down
     to what a reader needs and fed by a static payload in the same shape the visualizer's
     own /bundle endpoint returns (make_calls.py writes it). Three surfaces on one clock:

        the tape        two speech lanes, the marker rail above, the effects band below
        the transcript  every turn, the spoken one lit, click a line to seek
        the readout     what the grader returned, in the grader's terms

     The TIMELINE is the whole run. The AUDIO is a window of it - these calls are six to
     twenty minutes and eighteen of them in two codecs is about 100 MB - so the window is
     drawn on the tape as a bracket and the transport is clamped to it. Nothing pretends
     the excerpt is the call. */


  function tapesReady() {
    if (tapesFetch) return tapesFetch;
    const keys = [];
    tapeStops.forEach((ts) => ts.cfg.forEach((t) => keys.push(t.key)));
    const base = (CALLS && CALLS.base) || '../';
    tapesFetch = Promise.all(keys.map((k) =>
      fetch(base + 'call_' + k + '.json')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
        .then((j) => { tapeData[k] = j; })
        .catch((e) => { console.warn('flight: call "' + k + '" did not load:', e.message); })));
    return tapesFetch;
  }

  function fmtClock(s) {
    if (!isFinite(s) || s < 0) s = 0;
    return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  }

  /* One tile. Returns nothing; everything hangs off the figure it is given. */
  function buildTape(fig, D, full) {
    // `fig` is the BOX inside the figure, or the body of the open dialog when `full`. The playing state has to land on the figure
    // itself, because that is what the sheet keys the playhead off - written on the box it
    // was a class nothing could ever match, and the playhead stayed invisible while the
    // audio ran.
    const card = fig.closest('.fw-tp') || fig;
    const dur = D.dur || 1;
    const pct = (t) => (100 * Math.max(0, Math.min(dur, t)) / dur).toFixed(3) + '%';
    fig.innerHTML = '';

    // ---- the tape
    const tape = el('div', 'fw-tp-tape');
    // The whole figure already carries the reading of itself as its accessible name, and a
    // stack of absolutely positioned <i> elements announces as nothing useful.
    tape.setAttribute('aria-hidden', 'true');

    const rail = el('div', 'fw-tp-rail');
    D.marks.forEach((m) => {
      if (MARK_SHOWN.indexOf(m.kind) < 0) return;
      const i = el('i', 'fw-tp-mk');
      i.style.left = pct(m.t);
      i.style.setProperty('--mk', MARK_INK[m.kind] || 'var(--grey)');
      i.title = (MARK_SAY[m.kind] || m.kind) + (m.note ? ' (' + m.note + ')' : '')
        + ' at ' + fmtClock(m.t);
      rail.appendChild(i);
    });
    D.tools.forEach((t) => {
      const i = el('i', 'fw-tp-tool' + (t.ok ? '' : ' is-err'));
      i.style.left = pct(t.t);
      i.title = t.name + (t.ok ? '' : ' (returned an error)') + ' at ' + fmtClock(t.t);
      rail.appendChild(i);
    });
    tape.appendChild(rail);

    [['agent', 'Agent'], ['user', 'Caller']].forEach(([who, label]) => {
      const lane = el('div', 'fw-tp-lane is-' + who);
      const nm = el('span', 'fw-tp-lane-n');
      nm.textContent = label;
      lane.appendChild(nm);
      const track = el('div', 'fw-tp-track');
      (D.lanes[who] || []).forEach(([a, b]) => {
        const seg = el('i', '');
        seg.style.left = pct(a);
        // A 0.2 s utterance in a 20 minute call is a sixth of a pixel. Floored so a short
        // turn is visible as a turn rather than as nothing.
        seg.style.width = 'max(2px, ' + (100 * (b - a) / dur).toFixed(3) + '%)';
        track.appendChild(seg);
      });
      lane.appendChild(track);
      tape.appendChild(lane);
    });

    // Effects sit UNDER the lanes because they are done to the call, not by it.
    if (D.fx && D.fx.length) {
      const fxl = el('div', 'fw-tp-fx');
      D.fx.forEach((f) => {
        const i = el('i', 'fw-tp-fxs is-' + String(f.kind).replace(/[^a-z_]/g, ''));
        i.style.left = pct(f.s);
        i.style.width = 'max(1.5px, ' + (100 * (f.e - f.s) / dur).toFixed(3) + '%)';
        i.title = (FX_SAY[f.kind] || f.kind) + ' at ' + fmtClock(f.s);
        fxl.appendChild(i);
      });
      tape.appendChild(fxl);
    }

    // The window the shipped audio covers, drawn on the run it came from.
    const win = D.win || [0, dur];
    const over = el('div', 'fw-tp-over');
    const wb = el('div', 'fw-tp-win');
    wb.style.left = pct(win[0]);
    wb.style.width = (100 * (win[1] - win[0]) / dur).toFixed(3) + '%';
    over.appendChild(wb);
    const head = el('div', 'fw-tp-head');
    over.appendChild(head);
    tape.appendChild(over);
    fig.appendChild(tape);

    const scale = el('div', 'fw-tp-scale');
    const a0 = el('span', ''); a0.textContent = '0:00';
    const a1 = el('span', 'fw-tp-scale-w');
    a1.textContent = 'audio: ' + fmtClock(win[0]) + ' to ' + fmtClock(win[1]);
    const a2 = el('span', ''); a2.textContent = fmtClock(dur);
    scale.append(a0, a1, a2);
    fig.appendChild(scale);

    /* The tile stops here: a header, its one line, and the shape of the whole call. The
       transport and the transcript belong to the open view, because a tile carrying an
       audio player and 40 turns of dialogue is a page of players, and because a reader who
       wants to LISTEN to a call wants the room to read it at the same time. */
    if (!full) {
      const cue = el('div', 'fw-tp-cue');
      cue.textContent = 'Open the call';
      const arw = el('span', 'fw-tp-cue-a');
      arw.setAttribute('aria-hidden', 'true');
      arw.textContent = '\u2192';
      cue.appendChild(arw);
      fig.appendChild(cue);
      return;
    }

    // ---- the transport
    const pl = el('div', 'fw-tp-pl');
    const btn = el('button', 'fw-tp-btn');
    btn.type = 'button';
    btn.innerHTML = PLAY_SVG;
    btn.setAttribute('aria-label', 'Play the excerpt of this call');
    const bar = document.createElement('input');
    bar.type = 'range';
    bar.className = 'fw-tp-bar';
    bar.min = '0'; bar.max = '1000'; bar.value = '0';
    bar.setAttribute('aria-label', 'Position in the excerpt');
    const tm = el('span', 'fw-tp-time');
    tm.textContent = '0:00';
    const au = document.createElement('audio');
    au.preload = 'none';
    /* Opus FIRST, then AAC. Both are shipped for every call. Chrome reports Opus as
       "probably" and takes the first it can play, so listing AAC first made every Chrome
       reader download the larger file - measured at +57% across the set - while Safari,
       which cannot decode Ogg at all, falls through to the AAC either way.

       The extension is STRIPPED before the two are appended. Every call payload states
       `audio` with its extension already on it ("audio/bank_narr_ok.opus"), so appending
       another asked for audio/bank_narr_ok.opus.opus and .opus.m4a - both 404. The tile
       player builds its URLs from the same field by substitution rather than by appending,
       which is why a recording played from its tile and then fell silent the moment the
       call was opened. Stripping first also accepts a payload that carries a bare stem. */
    const stem = String(D.audio || '').replace(/\.(opus|m4a)$/i, '');
    if (stem) {
      [[stem + '.opus', 'audio/ogg; codecs=opus'], [stem + '.m4a', 'audio/mp4']]
        .forEach(([u, ty]) => {
          const so = document.createElement('source');
          so.src = (CALLS && CALLS.base ? CALLS.base : '') + u;
          so.type = ty;
          au.appendChild(so);
        });
    }
    pl.append(btn, bar, tm);
    fig.appendChild(pl);
    fig.appendChild(au);

    // ---- the transcript
    const list = el('div', 'fw-tp-turns');
    /* Every turn of the call, not the window's slice. The window is what you can HEAR; the
       transcript is what was said, and a reader who has opened the call has asked for the
       whole thing. Turns outside the audible window are marked so it is clear which part
       the recording covers rather than leaving the reader to wonder why play does nothing
       against the first ten minutes. */
    D.turns.forEach((t) => {
      const inWin = t.e > win[0] && t.s < win[1];
      const row = el('button', 'fw-tp-turn is-' + t.who + (inWin ? '' : ' is-outside'));
      row.type = 'button';
      if (!inWin) row.title = 'Outside the excerpt that was shipped as audio';
      row.dataset.s = String(t.s);
      row.dataset.e = String(t.e);
      const w = el('span', 'fw-tp-who');
      w.textContent = t.who === 'agent' ? 'Agent' : 'Caller';
      const x = el('span', 'fw-tp-txt');
      x.textContent = t.text;
      const c = el('span', 'fw-tp-at');
      c.textContent = fmtClock(t.s);
      row.append(w, x, c);
      // Seeking by clicking a line is the one interaction the visualizer's transcript has
      // that a reader immediately tries. A <button> rather than a div with onclick, so it
      // is reachable and operable from the keyboard.
      row.addEventListener('click', () => {
        if (!inWin) return;               // there is no audio at that second to seek to
        const at = Math.max(0, Math.min(win[1] - win[0], t.s - win[0]));
        au.currentTime = at;
        if (au.paused) btn.click();
      });
      list.appendChild(row);
    });
    fig.appendChild(list);

    // ---- playback
    let raf = 0;
    const rows = [...list.querySelectorAll('.fw-tp-turn')];
    const paint = () => {
      const at = win[0] + (au.currentTime || 0);
      head.style.left = pct(at);
      head.style.opacity = '1';
      const span = Math.max(0.001, win[1] - win[0]);
      bar.value = String(Math.round(1000 * (au.currentTime || 0) / span));
      tm.textContent = fmtClock(at) + ' / ' + fmtClock(dur);
      let live = null;
      rows.forEach((r) => {
        const on = at >= Number(r.dataset.s) - 0.15 && at <= Number(r.dataset.e) + 0.15;
        r.classList.toggle('is-now', on);
        if (on && !live) live = r;
      });
      // Follow the speech, but only inside the tile: scrolling the PAGE while a recording
      // plays would drag the reader out of the section they are listening to.
      if (live && live !== fig.__lastLive) {
        fig.__lastLive = live;
        const lt = live.offsetTop - list.clientHeight * 0.42;
        list.scrollTo({ top: Math.max(0, lt), behavior: 'smooth' });
      }
      if (!au.paused) raf = requestAnimationFrame(paint);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    au.addEventListener('play', () => {
      btn.innerHTML = PAUSE_SVG;
      card.classList.add('is-playing');
      stop();
      raf = requestAnimationFrame(paint);
    });
    ['pause', 'ended'].forEach((ev) => au.addEventListener(ev, () => {
      btn.innerHTML = PLAY_SVG;
      card.classList.remove('is-playing');
      stop();
      paint();
    }));
    btn.addEventListener('click', () => {
      if (au.paused) {
        // One clip at a time, across the whole page. Two calls playing over each other is
        // the fastest way to make a page of recordings unusable.
        document.querySelectorAll('audio').forEach((o) => { if (o !== au) o.pause(); });
        au.play().catch(() => { tm.textContent = 'recording unavailable'; });
      } else {
        au.pause();
      }
    });
    bar.addEventListener('input', () => {
      const span = Math.max(0.001, win[1] - win[0]);
      au.currentTime = span * (Number(bar.value) / 1000);
      paint();
    });
    // Cancels the loop and drops the decoder when the section leaves.
    fig.__tapeStop = () => { stop(); au.pause(); };
    /* Open on the audible part. The transcript is the whole call, so it opens at 0:00
       while the transport sits at the start of the window - which reads as the two being
       out of step until you press play. Put the list where the recording actually is. */
    const firstIn = rows.find((r) => Number(r.dataset.e) > win[0]);
    if (firstIn) list.scrollTop = Math.max(0, firstIn.offsetTop - list.clientHeight * 0.28);
    paint();
    head.style.opacity = '';
  }

  /* THE OPEN CALL.
     ---------------------------------------------------------------------------------
     The same dialog the walks use, so it inherits the focus trap, the Escape handler, the
     backdrop click and the focus return that were already got right there. What goes in it
     is the visualizer's own view of one conversation: the line of context, the two-lane
     speech activity timeline with every marker on it, the transport, the whole transcript
     following the playhead, and the grader's readout underneath. */
  let callOverlay = null;
  let callOpener = null;

  function closeCall() {
    if (!callOverlay) return;
    // Stop the audio before the node goes: a detached <audio> keeps playing.
    callOverlay.querySelectorAll('audio').forEach((a) => a.pause());
    const box = callOverlay.querySelector('.fw-tp-box');
    if (box && box.__tapeStop) box.__tapeStop();
    document.removeEventListener('keydown', onCallKey, true);
    callOverlay.remove();
    callOverlay = null;
    if (callOpener && document.contains(callOpener)) callOpener.focus();
    callOpener = null;
  }

  function onCallKey(e) {
    if (!callOverlay) return;
    if (e.key === 'Escape') { e.preventDefault(); closeCall(); return; }
    if (e.key !== 'Tab') return;
    const f = [...callOverlay.querySelectorAll(
      'button, [href], input, select, textarea, audio[controls], [tabindex]:not([tabindex="-1"])')]
      .filter((n) => !n.disabled && n.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* The enterprise calls and the recorded tapes are two payload shapes for one thing, and
     the open view only ever spoke the tape's. A run payload calls its speech `utterances`,
     its audio effects `effects`, states no duration and marks no excerpt window; the tape
     shape wants `turns`, `fx`, `dur`, `win` and `marks`. Handing one to the other threw on
     the first missing array and the dialog opened with a title and an empty body.

     Nothing is invented here: the duration is the last moment anything happens, and the
     window is the whole call, because the whole call is exactly what the tile could not
     show and what opening it is for. */
  function asTape(D) {
    if (!D) return null;
    if (D.turns && D.dur) return D;                 // already a tape
    const turns = D.utterances || D.turns || [];
    const lanes = D.lanes || {};
    const ends = [].concat(
      turns.map((t) => t.e || 0),
      (lanes.agent || []).map((p) => p[1] || 0),
      (lanes.user || []).map((p) => p[1] || 0),
      (D.tools || []).map((t) => t.t || t.s || 0));
    const dur = D.dur || (ends.length ? Math.ceil(Math.max.apply(null, ends)) : 1);
    /* Talk time and tool count are not stated by a run payload, but they are IN it: the
       lanes are the speech and the tools are the tool calls. Derived rather than left
       blank, and derived rather than typed, so they cannot disagree with the timeline
       drawn from the same two arrays. */
    const secs = (v) => (v || []).reduce((a, [x, y]) => a + Math.max(0, (y || 0) - (x || 0)), 0);
    const score = Object.assign({}, D.score);
    if (score.talk == null && (lanes.agent || lanes.user)) {
      score.talk = { agent: secs(lanes.agent), user: secs(lanes.user) };
    }
    if (score.tool_calls == null && D.tools) score.tool_calls = D.tools.length;
    return {
      key: D.key, meta: D.meta, score: score, audio: D.audio,
      turns: turns, lanes: lanes, tools: D.tools || [],
      fx: D.fx || D.effects || [], marks: D.marks || [],
      dur: dur, win: [0, dur],
    };
  }

  function openCall(D, cfg, opener) {
    /* The opener is PASSED, not read off document.activeElement. Clicking a div does not
       focus it in Chrome and clicking a button does not focus it in Safari, so reading the
       active element recorded <body> for most mouse users and focus returned to the top of
       the document on close. */
    const from = opener || document.activeElement;
    closeCall();
    callOpener = from;
    const ov = el('div', 'fw-walk fw-call');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', (cfg.type || 'A call') + ', '
      + (cfg.verdict === 'bad' ? 'fail' : 'pass') + ', ' + (cfg.model || ''));
    const card = el('div', 'fw-walk-card fw-call-card');
    const head = el('header', 'fw-walk-head fw-call-head');
    const t = el('div', 'fw-walk-title');
    t.textContent = cfg.type || '';
    const vd = el('span', 'fw-tp-verdict' + (cfg.verdict === 'bad' ? ' is-bad' : ''));
    vd.textContent = cfg.verdict === 'bad' ? 'Fail' : 'Pass';
    const who = el('span', 'fw-tp-model');
    who.style.setProperty('--sys-t', sysTextColor(cfg.model || ''));
    who.innerHTML = vendorMark(cfg.model || '');
    const wn = el('span', '');
    wn.textContent = cfg.model || '';
    who.appendChild(wn);
    const sub = el('div', 'fw-walk-sub');
    sub.textContent = cfg.line || '';
    const x = el('button', 'fw-walk-x');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.textContent = '\u00d7';
    x.addEventListener('click', closeCall);
    const row = el('div', 'fw-call-headrow');
    row.append(t, vd, who);
    head.append(row, sub, x);
    const body = el('div', 'fw-walk-body fw-call-body');
    const box = el('div', 'fw-tp-box');
    body.appendChild(box);
    card.append(head, body);
    ov.appendChild(card);
    ov.addEventListener('click', (e) => { if (e.target === ov) closeCall(); });
    document.body.appendChild(ov);
    callOverlay = ov;
    document.addEventListener('keydown', onCallKey, true);
    x.focus();
    buildTape(box, D, true);
    // What the grader returned, in the grader's own terms, under the conversation it is
    // about. Read out of the payload rather than typed, so it cannot disagree with the run.
    const sc = D.score || {};
    const stats = el('div', 'fw-call-stats');
    const talk = sc.talk || {};
    /* A field that is not in this payload is LEFT OUT, not printed as a question mark. The
       enterprise calls and the recorded tapes carry different grader output - one states
       talk time and a termination reason, the other does not - and a row of "?" said the
       call was missing something rather than that this shape never had it. */
    [['Reward', sc.reward == null ? null : String(sc.reward)],
     ['Ended', sc.termination ? String(sc.termination).replace(/_/g, ' ') : null],
     ['Agent speech', talk.agent != null ? Math.round(talk.agent) + ' s' : null],
     ['Caller speech', talk.user != null ? Math.round(talk.user) + ' s' : null],
     ['Tool calls', sc.tool_calls == null ? null : String(sc.tool_calls)],
     ['Background', sc.noise || null]].filter(([, v]) => v != null).forEach(([k, v]) => {
      const c = el('div', 'fw-call-stat');
      const kk = el('span', 'fw-call-stat-k');
      kk.textContent = k;
      const vv = el('b', '');
      vv.textContent = v;
      c.append(kk, vv);
      stats.appendChild(c);
    });
    body.appendChild(stats);
  }

  function mountTapes(stop) {
    tapeStops.forEach((ts) => {
      if (ts.i !== stop) return;
      tapesReady().then(() => {
        ts.grid.querySelectorAll('.fw-tp').forEach((fig) => {
          if (fig.__built) return;
          const D = tapeData[fig.dataset.key];
          if (!D) { fig.querySelector('.fw-tp-box').textContent = 'This call did not load.'; return; }
          fig.__built = true;
          buildTape(fig.querySelector('.fw-tp-box'), D);
        });
        measureSpill();
      });
    });
  }

  function tapesOnStopChange(stop) {
    if (!tapeStops.length) return;
    /* Build when the section is APPROACHED, but stop the audio the moment it is no longer
       the live stop. Those are deliberately different thresholds: building early is what
       makes the tiles ready when the reader arrives, whereas a recording that outlives its
       own section is playing from a panel that is hidden and inert, with the pause button
       the reader would reach for no longer on screen. On a three-section page a one-stop
       tolerance covers the entire document, so this was every scroll. */
    const live = tapeStops.some((ts) => ts.i === stop);
    if (!live) {
      document.querySelectorAll('.fw-tp .fw-tp-box').forEach((f) => {
        if (f.__tapeStop) f.__tapeStop();
      });
    }
    // Exact stop first, then nearest, for the same reason the runs and maps do.
    const near = tapeStops.find((ts) => ts.i === stop)
      || tapeStops
        .filter((ts) => Math.abs(ts.i - stop) <= 1)
        .sort((a, b) => Math.abs(a.i - stop) - Math.abs(b.i - stop))[0];
    if (near) mountTapes(near.i);
  }

  // ---------------------------------------------------------------- geometry
  // Each section owns a band of scroll measured in viewport heights. Its camera
  // keyframe sits at the CENTRE of its band, and the camera interpolates between
  // consecutive centres. That is what makes the whole page one continuous move
  // instead of a sequence of slides: there is no moment when nothing is moving
  // except the deliberate settle inside a band.
  /* Every stop owns a band of scroll, given in viewport heights. On a stop that carries the
     FILM that number is the pacing of the film and is authored: it says how long the camera
     takes over this part of the flight.
     On a full-width band the film stands down - the video box is literally 0x0 under
     [data-block="band"] - so the same number buys the reader nothing. It was being authored
     the same way anyway, and the result was measurable: on the results page the five world
     stops were 5.0 viewports each for 0.9 viewports of table, so four screens of scrolling
     out of every five changed nothing on screen at all. 46.9 viewports of page for 13 of
     content. That is the "empty scroll" this fits away.
     So `scroll` is honoured on a filmed stop and REPLACED on a band by fitBands(), which
     measures the panel and gives it the scroll its own content needs. This is why the
     scrolling now feels the same on every page: the pages no longer each carry a hand-tuned
     guess at a length that only one window size ever made sense at. */
  const bands = S.map((s) => s.scroll || 1.25);
  function bandSum() { return bands.reduce((a, b) => a + b, 0); }
  function vh() { return window.innerHeight; }
  function vw() { return window.innerWidth; }
  // Every one of these is constant between resizes, and paintCopy used to recompute
  // centrePx(i) inside its own loop - a quadratic pile of additions plus an innerHeight read
  // per section, every animation frame. Cached in measure(), which layout() calls.
  let centres = [];
  let total = 0;
  /* How far each band panel overflows the viewport, which is how far it has to travel to
     show its own tail. This was being derived in paintCopy from `offsetTop` + `scrollHeight`
     - two layout reads per band section, interleaved with the inline style writes made for
     the previous section, so each one forced a synchronous reflow. Measured at nine forced
     reflows per animation frame on the results page. It only changes on resize, which is
     exactly when measure() runs. */
  let spills = [];
  /* How tall each band panel actually is. Not the same question as the spill - the spill is
     what does not fit and the height is what does - and the two are wanted for opposite
     reasons: the spill sets how far the panel travels, the height sets where it sits when
     it does not have to travel at all. */
  const panelPx = [];
  /* Measured LAZILY, per panel, the first time that panel is actually on screen.
     -----------------------------------------------------------------------------------
     Measuring them all in one pass at layout looks tidier and is wrong: every panel except
     the live one carries the `hidden` attribute, and a hidden element reports offsetTop 0
     and scrollHeight 0. So the eager version recorded "no overflow" for every panel the
     reader had not reached yet, and those panels then never travelled - which is precisely
     the bug the travel exists to prevent, a panel taller than the viewport hiding its own
     tail. Doing it on the stop change costs two layout reads per section per resize, which
     is nothing, and keeps the paint loop free of layout reads either way. */
  function measureSpill() { spills = []; }
  function spillOf(i) {
    if (spills[i] != null) return spills[i];
    const s = S[i];
    if (!s || s.block !== 'band') return 0;
    const pan = panels[i];
    // Not measurable yet. Return 0 WITHOUT caching, so the next frame tries again rather
    // than freezing the wrong answer in for the life of the layout.
    if (!pan || pan.hidden || !pan.offsetHeight) return 0;
    spills[i] = (pan.offsetTop || 0) + pan.scrollHeight - (vh() - 24);
    return spills[i];
  }
  /* HOW LONG A FULL-WIDTH BAND ACTUALLY NEEDS TO BE.
     ---------------------------------------------------------------------------------
     A band panel travels its whole overflow inside 72% of its band (see the RUN constant
     in paintCopy). So a band of `spill / 0.72` viewports moves the copy at roughly the
     speed of the scroll - a screen of scrolling shows a screen of new content - and a
     band longer than that is the panel standing still while the reader scrolls.
     On top of that, 1.05 viewports: enough for the panel to arrive, be read where it is
     wholly still, and dissolve into the next one. The floor of 1.4 is what keeps a short
     stop from flicking past; the ceiling is whatever the page authored, because this may
     only ever SHORTEN a band, never stretch one.

     Measured rather than assumed, because a panel's height is a function of the viewport
     width - the same table is 0.9 viewports tall at 1600 and well over two on a laptop -
     so a hand-tuned number is right at exactly one window size. This runs in layout(),
     which is already the resize path, so the fit follows the window.

     The panels are hidden when they are not live and a hidden element measures 0, so each
     one is revealed with visibility:hidden for the read - the same trick fitFilm() already
     uses on the stacked shell. `data-block` is forced to `band` for the duration because a
     band panel measured in the split layout gets the narrow column and reports a height it
     will never have. Both are restored before the frame ends, so nothing paints. */
  function fitBands() {
    const H = vh();
    if (!H) return;
    const keep = root.dataset.block;
    let touched = false;
    for (let i = 0; i < N; i++) {
      const s = S[i];
      const pan = panels[i];
      if (!s || s.block !== 'band' || !pan) continue;
      /* A STAGED stop is paced by its reveal, not by its content.
         `steps` spends the band showing one tile, then two, then three, so the band is the
         reveal's running time in the same way a filmed stop's band is the camera's. Fitting
         it to the height of the finished grid put all three steps inside 1.4 viewports:
         measured on the samples page, the reveal was already at its last step 76px into the
         page, so the reader never saw a single sample on its own - which is the entire
         point of staging it. The authored number stands. */
      if (!touched) { root.dataset.block = 'band'; touched = true; }
      const wasHidden = pan.hidden;
      const wasOp = pan.style.opacity;
      const wasVis = pan.style.visibility;
      pan.hidden = false;
      pan.style.opacity = '0';
      pan.style.visibility = 'hidden';
      const panelH = pan.scrollHeight;
      const content = (pan.offsetTop || 0) + panelH;
      pan.hidden = wasHidden;
      pan.style.opacity = wasOp;
      pan.style.visibility = wasVis;
      if (!content) continue;
      /* The panel's own height, kept for the vertical centring below. Measured HERE and
         nowhere else: this is the one place on the band path where a hidden panel is
         revealed, and doing it a second time would be a second forced reflow per stop. */
      panelPx[i] = panelH;
      const spill = Math.max(0, content - (H - 24));
      // A staged stop is measured like any other - the centring needs its height - but its
      // band length is the reveal's running time, not its content's, so it stops here.
      if (s.steps > 1) continue;
      const need = 1.05 + (spill / H) / 0.72;
      // The authored number is not a ceiling here. It is on a FILMED stop, where it is the
      // camera's pacing, but a band has no film to pace, so the content is the only thing
      // that can say how long the band should be - and a band shorter than its content makes
      // the panel race past instead. 8 is a backstop against a payload that arrives ten
      // times bigger than anything on the page today, not a design limit.
      bands[i] = Math.max(1.4, Math.min(8, need));
    }
    if (touched) {
      if (keep == null) delete root.dataset.block;
      else root.dataset.block = keep;
    }
  }

  function measure() {
    const H = vh();
    fitBands();
    // The opening is in flow, so it occupies real document height ABOVE the flight. Every
    // centre has to move down by exactly that much or the first stop lands underneath it.
    const openPx = openEl ? openEl.offsetHeight : 0;
    const lead = ((VID && VID.lead) || 0) * H + openPx;
    total = bandSum() * H + lead;
    let acc = 0;
    centres = bands.map((b) => {
      // Every stop shifts down by the lead, so the gaps BETWEEN stops - which is what sets
      // each leg's pacing - are untouched by it.
      const c = (acc + b / 2) * H + lead;
      acc += b;
      return c;
    });
  }
  measure();
  measureSpill();
  /* A band panel's height is not settled when its spill is first measured, and the spill is
     what the travel is derived from. The tiles arrive asynchronously - a payload fetch, then
     a timeline built from it - images decide their own height once decoded, and a webfont
     swap reflows the copy. All of that happens AFTER the panel became visible and its spill
     was cached, so the panel then travelled by the pre-fill amount and its tail stayed below
     the fold for the whole band, unreachable at any scroll position.
     Measured on samples.html at 1100px wide: panel 3984px tall, tail 1.9k px short of ever
     being on screen. The stop-change and post-build calls to measureSpill() did not cover it
     because neither fires when an already-built panel simply grows.
     Observing the panels closes it: any size change drops the cache and the next frame
     recomputes. measureSpill() only clears, so this cannot feed back into a resize loop. */
  /* The same lateness applies to the BAND LENGTH now that it is fitted to the content: a
     panel that grows after the fit ran is a panel whose band is too short for it. So the
     observer re-runs the whole layout rather than only dropping the spill cache, debounced
     because eighteen tiles arriving one at a time is eighteen size changes.
     This cannot feed back. fitBands() reveals and restores each panel inside ONE task, so
     the size the observer compares against at the end of the frame is the size it already
     reported, and a re-layout that changes nothing schedules nothing. */
  let refitPending = 0;
  if (typeof ResizeObserver === 'function') {
    const spillRO = new ResizeObserver(() => {
      measureSpill();
      clearTimeout(refitPending);
      refitPending = setTimeout(() => { layout(true); }, 160);
    });
    panels.forEach((pan, i) => {
      if (pan && S[i] && S[i].block === 'band') spillRO.observe(pan);
    });
  }
  /* A STOP CAN BE LINKED TO.
     ---------------------------------------------------------------------------------
     The flight is one long scroll with no anchors in it, so until now the only way to name
     a place in it was a page. That stopped being true when the at-a-glance grid became a
     stop rather than a page of its own: the header has to be able to send a reader to it.
     `index.html#overview` resolves to the section whose id is `overview` and scrolls to the
     middle of its band, which is where the stop is fully lit. A hash that matches nothing
     is left alone, so the skip link and any ordinary anchor behave as they always did. */
  function jumpToHash(smooth) {
    const id = String(location.hash || '').replace(/^#/, '');
    if (!id) return false;
    const i = S.findIndex((s) => s && s.id === id);
    if (i < 0) return false;
    // `pos` is the viewport CENTRE (scrollY + vh/2), so landing the stop in the middle of
    // the screen means scrolling to its centre MINUS half a viewport. Without the subtraction
    // the header's Overview link put the reader half a screen past the stop, on the fade out
    // of it - the grid arrived already going.
    window.scrollTo({ top: landingPx(i),
                      behavior: (smooth && !reduce) ? 'smooth' : 'auto' });
    return true;
  }
  /* On load the geometry has to exist first, and images can still change it, so this runs
     once now and once after the next frame rather than fighting a half-measured page.
     layout(), not measure(). measure() alone recomputes the centres and leaves the SPACER
     at whatever height the last layout gave it, and now that a band's length is fitted to
     its content the two genuinely disagree: opening index.html#overview landed on a 5,917px
     document whose centres were laid out for 12,094, so the jump ran off the end of the page
     and the reader arrived back at the opening statement. layout() sets both. */
  /* A cold load with a hash is a RACE, and the hash was losing it.
     The page keeps re-laying-out for a second or so after load - fonts swap, the film box
     resolves, a payload lands and a band is refitted - and every one of those layouts ends
     by restoring the reader to `lastFrac`, the fraction of the page they were last SEEN at.
     A jump made before any frame has sampled the new position is a jump whose fraction is
     still zero, so the next layout quietly puts the reader back at the top. Arriving at
     index.html#overview from another page landed on the opening statement every time, while
     clicking the same entry from inside the page worked - because there the fraction was
     already right.
     So the hash is held as PENDING and re-asserted by each layout until either the reader
     takes over or the page settles. */
  let hashPending = !!location.hash &&
    S.some((s) => s && s.id === String(location.hash).replace(/^#/, ''));
  const dropHash = () => { hashPending = false; };
  if (hashPending) {
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((ev) =>
      window.addEventListener(ev, dropHash, { passive: true, once: true }));
    setTimeout(dropHash, 2500);
    requestAnimationFrame(() => { layout(); jumpToHash(false); });
    window.addEventListener('load', () => { layout(); jumpToHash(false); });
  }
  window.addEventListener('hashchange', () => { dropHash(); jumpToHash(true); });
  /* WHERE A SHORT BAND PANEL SITS.
     The copy column pads 96px off the top of the screen and the panel hangs from there,
     which is right for a panel that overflows - it has to start at the top or its tail never
     arrives. For one that FITS it is just a panel in the top half of the screen with a third
     of the viewport empty underneath: measured on the samples page, every stop left between
     232 and 306 pixels of nothing below the content, at every scroll position, on a 757px
     screen. A panel that fits is centred instead.
     The cap matters on a STAGED stop, whose panel has a different height at every step - the
     pad is computed once from one of them, so it must not be a pad that puts a taller step
     off the bottom of the screen.
     Written as a custom property on the column rather than a style on the panel, because the
     panel's own transform is rewritten every frame by the travel. */
  function syncBandPad(i) {
    const H = vh();
    const nh = panelPx[i] || 0;
    const band = S[i] && S[i].block === 'band';
    const pad = band && nh && nh < H - 40
      ? Math.min(Math.max(76, Math.round((H - nh) / 2)), Math.round(H * 0.3))
      : 96;
    copyWrap.style.setProperty('--band-pad', pad + 'px');
  }

  /* WHERE A JUMP SHOULD LAND.
     ---------------------------------------------------------------------------------
     Every rail dot, globe, stepper arrow, hash link and goto() used to scroll to the band's
     CENTRE, on the reasoning that the centre is where the stop is fully lit. That is true,
     and for a tall panel it is also two thirds of the way through its own content: the
     travel runs from the band's leading edge to 72% of it, so at the centre the panel has
     already moved 0.5/0.72 of its overflow. Measured on the pairs stop of the samples page,
     which overflows by 1,416px: a jump landed 983px down the panel, past the heading, in
     the middle of a grid of call tiles with nothing on screen to say what they were.
     So a stop that travels is entered at the TOP of its travel instead, nudged just far
     enough in that the panel is at full opacity when it gets there - 8% of the run, which
     is about a tenth of a screen of content, and leaves the heading where a heading goes.
     A stop that does not travel is unchanged: its centre is its everything. */
  function landingPx(i) {
    const c = centrePx(i);
    if (!Number.isFinite(c)) return 0;
    const s = S[i];
    const H = vh();
    if (!s || s.block !== 'band' || spillOf(i) <= 8) return Math.max(0, c - H / 2);
    // The exact start of the travel, which is now also the first position at which the
    // panel is fully lit. See the note beside `from` in paintCopy.
    const half = bands[i] * H * 0.5;
    return Math.max(0, Math.max(c - half * 0.6, H / 2) - H / 2);
  }

  function totalPx() { return total; }
  function centrePx(i) { return centres[i]; }

  // The copy band has to fit the TALLEST panel, because all five are stacked in one grid
  // cell. A fixed reserve cannot do this: panel height grows as the window narrows and
  // titles rewrap, and again if the reader enlarges text. Measured at 1366x768 the tallest
  // panel wanted 355px against a 278px band and the primary CTA was silently clipped by a
  // stage that is overflow:hidden. So measure, then give the film whatever is left.
  // One film height per stop, not one for the whole page. Sizing everything from the tallest
  // panel meant the shortest stop paid for the longest one: the opening and closing statements
  // are a third the height of a pair stop, and their film was held small for no reason.
  let filmPx = [];

  function fitFilm() {
    if (SHELL !== 'stacked') return;
    // This has to iterate. The copy band's width is bound to the film's width so the two
    // share an outer edge, which means panel height depends on film size, which depends on
    // panel height. One pass settles wherever it happens to land; three converge.
    // The band's own top and bottom padding, read rather than remembered. It is a clamp on
    // vh in the sheet, so the constant 46 that used to stand here was wrong at both ends:
    // it over-reserved by 11px on a 768px laptop and UNDER-reserved by 6px above about
    // 1100px tall, which is the exact clipping this function exists to prevent.
    const cs = getComputedStyle(copyWrap);
    const PAD = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    let px = 0;
    for (let pass = 0; pass < 3; pass++) {
      let tallest = 0;
      const heights = [];
      panels.forEach((p) => {
        const wasHidden = p.hidden;
        const wasOpacity = p.style.opacity;
        p.hidden = false;
        p.style.opacity = '0';         // measurable, never a visible flash
        heights.push(p.scrollHeight);
        tallest = Math.max(tallest, p.scrollHeight);
        p.hidden = wasHidden;
        p.style.opacity = wasOpacity;
      });
      // Per panel, measured in the same pass. The ceiling is higher than the shared value so
      // a short stop genuinely opens up rather than merely matching the crowd.
      filmPx = heights.map((hh) =>
        Math.round(Math.max(vh() * 0.22, Math.min(vh() * 0.74, vh() - (hh + PAD)))));
      const want = Math.min(vh() * 0.6, vh() - (tallest + PAD));
      // Floor at 30vh: past that the film is too small to be worth showing, and the honest
      // answer is shorter copy rather than a postage stamp.
      const next = Math.round(Math.max(vh() * 0.22, want));
      if (Math.abs(next - px) < 2) break;
      px = next;
      document.documentElement.style.setProperty('--film', px + 'px');
    }
    // Land on the CURRENT stop's own value here rather than leaving the tallest-panel value
    // for paintCopy to replace on the next stop change. Writing it later is a layout shift
    // measured at CLS 0.15 on first paint, over the 0.1 threshold.
    if (filmPx[liveStop]) {
      document.documentElement.style.setProperty('--film', filmPx[liveStop] + 'px');
      root.dataset.stop = String(liveStop);
    }
  }

  // 100vw includes the classic scrollbar; documentElement.clientWidth does not. Every width
  // in the sheet derived from raw 100vw was therefore up to 15px too wide, which at 430px
  // put the film at x = -7 with both edges clipped by the stage. Published as --sbw so the
  // sheet can subtract it. It has to be read AFTER the spacer has its height, or the page
  // is not yet long enough to have a scrollbar and the answer is always zero.
  function syncScrollbar() {
    const w = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    if (w !== lastSbw) {
      lastSbw = w;
      document.documentElement.style.setProperty('--sbw', w + 'px');
    }
  }

  // The film's real painted box, published for the sheets.
  //
  // The name plate has to sit against the picture, and the picture is not a fixed size or a
  // fixed place: fitFilm gives each stop its own height, and each shell positions it
  // differently. Anchored to the stage instead, the plate sat at the bottom of the window
  // while the film floated in the middle of it, and the two read as unrelated. There is no
  // way to express "under the film" in the sheet alone, so the measurement is published.
  // The keynote matrix leaves a hole in its middle cell and the film has to sit in it
  // exactly. There is no way to say "be that cell" in the sheet - the cell is in the copy
  // column and the film is in the stage - so the cell is measured and published.
  let lastHole = '';
  function publishHole() {
    const h = copyWrap.querySelector('.fw-panel.is-live .fw-sum-hole');
    if (!h) return;
    const b = h.getBoundingClientRect();
    if (!b.width) return;
    const key = [b.x, b.y, b.width, b.height].map(Math.round).join(',');
    if (key === lastHole) return;
    lastHole = key;
    const st = document.documentElement.style;
    st.setProperty('--hole-x', Math.round(b.x + b.width / 2) + 'px');
    st.setProperty('--hole-y', Math.round(b.y + b.height / 2) + 'px');
    st.setProperty('--hole-w', Math.round(b.width) + 'px');
    st.setProperty('--hole-h', Math.round(b.height) + 'px');
  }

  let lastBox = '';
  function publishFilmBox() {
    const e = videoEl && !videoEl.hidden ? videoEl : heroImg;
    if (!e) return;
    const b = e.getBoundingClientRect();
    if (!b.width) return;
    const key = Math.round(b.x) + ',' + Math.round(b.y) + ',' +
                Math.round(b.width) + ',' + Math.round(b.height);
    if (key === lastBox) return;               // per-frame writes would relayout constantly
    lastBox = key;
    const st = document.documentElement.style;
    st.setProperty('--film-x', Math.round(b.x) + 'px');
    st.setProperty('--film-y', Math.round(b.y) + 'px');
    st.setProperty('--film-w2', Math.round(b.width) + 'px');
    st.setProperty('--film-h2', Math.round(b.height) + 'px');
    st.setProperty('--film-bot', Math.round(b.bottom) + 'px');
  }

  /* `anchor` restores the reader by their offset INSIDE the live stop rather than by their
     fraction of the whole document.
     ---------------------------------------------------------------------------------
     Both are "keep the reader where they were", and which one is right depends on why the
     layout ran. On a RESIZE every band changes together and the fraction is the honest
     answer. On a REFIT - eighteen call tiles arriving one at a time, each one making its
     own band longer - only the bands at or below the reader change, so the fraction moves
     the page under them: measured on the samples page as the content stepping up and then
     back down while the tiles landed, which is what "the page keeps going up and down"
     describes. Anchoring to the live stop leaves the thing being read exactly where it is
     and lets the page grow underneath it. */
  function layout(anchor) {
    const aStop = anchor ? liveStop : -1;
    const aOff = aStop >= 0 && Number.isFinite(centrePx(aStop))
      ? window.scrollY - (centrePx(aStop) - vh() / 2)
      : 0;
    measure();
    // Once per layout, deliberately: these are the only two layout reads left on the band
    // path, and doing them here means the paint loop never touches the layout engine.
    measureSpill();
    spacer.style.height = totalPx() + 'px';
    syncScrollbar();
    fitFilm();
    publishHole();
    publishFilmBox();
    // fitFilm leaves --film at the TALLEST panel's value. paintCopy only replaces it with
    // this stop's own value when the stop index changes, so after a resize - where the stop
    // has not changed - the per-stop size was never restored and the film stayed shrunk to
    // fit a panel that is not on screen. Forgetting the index makes the next frame reapply.
    delete root.dataset.stop;
    // Stops are a fraction of a spacer that just changed height, so restore the reader's
    // place rather than letting them slide through the story. `instant` matters: the sheet
    // sets scroll-behavior:smooth on <html>, which would turn this into an animation and
    // then let the second frame() read a position the scroll has not reached yet.
    restoring = true;
    // Not on the first call. lastFrac is 0 until a frame has run, and the browser restores
    // the scroll position of a reloaded page on its own - so restoring here would drag a
    // reader who reloaded mid-flight back to the opening dome.
    if (!firstLayout) {
      // A hash the reader has not yet overridden outranks either restore: on a cold load the
      // fraction is still zero and restoring it is what threw the jump away.
      if (!(hashPending && jumpToHash(false))) {
        const top = aStop >= 0 && Number.isFinite(centrePx(aStop))
          ? centrePx(aStop) - vh() / 2 + aOff
          : lastFrac * totalPx() - vh() / 2;
        window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
      }
    }
    firstLayout = false;
    frame(true);
    restoring = false;
  }

  // ---------------------------------------------------------------- camera
  const smooth = (t) => t * t * (3 - 2 * t);

  // `linger` remaps progress within a leg so the camera settles as it arrives and
  // picks up again on the way out, which is when the copy is meant to be read.
  // Endpoints are untouched, so it can never desynchronise the chain.
  function lingered(t, amt) {
    if (!amt) return t;
    const s = smooth(t);
    return t + (s - t) * Math.min(0.85, amt);
  }

  // One number per section, interpolated across the same bands the camera uses, so anything
  // driven by it moves with the flight instead of snapping at a stop boundary. The mark's
  // growth is the only user today; keeping it general is what stops the next one becoming a
  // second, differently-eased timeline that drifts out of agreement with this one.
  function scalarAt(pos, key, dflt) {
    const v = (i) => (typeof S[i][key] === 'number' ? S[i][key] : dflt);
    if (pos <= centrePx(0)) return v(0);
    if (pos >= centrePx(N - 1)) return v(N - 1);
    let i = 0;
    while (i < N - 2 && pos > centrePx(i + 1)) i++;
    const a = centrePx(i), b = centrePx(i + 1);
    return v(i) + (v(i + 1) - v(i)) * smooth((pos - a) / (b - a));
  }

  function cameraAt(pos) {
    // pos is the scroll position of the viewport centre, in px.
    if (pos <= centrePx(0)) return { ...S[0].cam, i: 0, f: 0 };
    if (pos >= centrePx(N - 1)) return { ...S[N - 1].cam, i: N - 1, f: 0 };
    let i = 0;
    while (i < N - 2 && pos > centrePx(i + 1)) i++;
    const a = centrePx(i), b = centrePx(i + 1);
    const raw = (pos - a) / (b - a);
    const t = lingered(smooth(raw), (S[i].linger || 0) * 0.5 + (S[i + 1].linger || 0) * 0.5);
    const c0 = S[i].cam, c1 = S[i + 1].cam;
    return {
      x: c0.x + (c1.x - c0.x) * t,
      y: c0.y + (c1.y - c0.y) * t,
      // Zoom interpolates geometrically. A linear blend between 1.0 and 2.8 spends
      // most of its time already zoomed in and reads as a lurch on the way out.
      z: Math.exp(Math.log(c0.z) + (Math.log(c1.z) - Math.log(c0.z)) * t),
      i, f: raw,
    };
  }

  // ---------------------------------------------------------------- frame
  let cur = null;             // the smoothed camera actually drawn
  let target = null;
  let raf = 0;

  function focal() {
    // Where in the viewport the camera's target point sits. On a wide screen the
    // copy occupies the right, so the subject is offset left of centre; on a
    // narrow screen the copy sits below and the subject rides high.
    // Copy sits in a band along the bottom, so the subject centres horizontally and
    // rides above it rather than being pushed off to one side.
    return vw() > 900 ? { x: 0.50, y: 0.42 } : { x: 0.50, y: 0.36 };
  }

  function draw(cam) {
    const H0 = Math.min(vh() * 0.88, vw() * 0.88 / ASPECT);
    const H = H0 * cam.z;
    const W = H * ASPECT;
    const f = focal();
    const left = vw() * f.x - cam.x * W;
    const top = vh() * f.y - cam.y * H;
    heroImg.style.width = W + 'px';
    heroImg.style.height = H + 'px';
    heroImg.style.transform = `translate3d(${left}px, ${top}px, 0)`;

    // Push-in softens and darkens the backdrop. This is the honest handling of a
    // flat source: the deeper the dolly, the more the pixels are being stretched,
    // so that is exactly where the sharp foreground globe takes over.
    const depth = Math.max(0, Math.min(1, (cam.z - 1) / 1.9));
    heroImg.style.filter = reduce ? 'none' : `blur(${(depth * 7).toFixed(2)}px) saturate(${1 - depth * 0.28})`;
    veil.style.opacity = (depth * 0.66).toFixed(3);
    // Light on the wide shot so the world stays open, heavier once pushed in, which is
    // both when the copy is longest and when the backdrop behind it is brightest.
    scrim.style.opacity = (0.5 + depth * 0.5).toFixed(3);
  }

  // ---------------------------------------------------------------- ground match
  // The film's floor is not one colour. Measured off flight.mp4's own border pixels it runs
  // #e6e5e6 at the opening, #f5f2f1 at the third stop and #fefefe at the close, against a
  // page floor fixed at #e8e9e7 - a 22-level seam, and it lands on the closing stop, which
  // is exactly where the reader stops moving and looks. Nothing in a stylesheet can match a
  // moving target, so the page takes its floor from the frame that is actually on screen.
  //
  // The sample is the frame's BORDER ring, not its average: the middle is the subject and
  // averaging it in would drag the page grey every time a dark globe fills the shot.
  const GS = 40;                              // samples along each edge
  let gcan = null, gctx = null;
  let ground = null;                          // the eased colour currently written
  let groundAt = 0;

  function sampleGround() {
    if (!videoEl || !videoOK || videoEl.readyState < 2) return null;
    const VW = videoEl.videoWidth, VH = videoEl.videoHeight;
    if (!VW || !VH) return null;
    if (!gcan) {
      gcan = document.createElement('canvas');
      gcan.width = GS; gcan.height = 4;
      gctx = gcan.getContext('2d', { willReadFrequently: true });
    }
    // Four SOURCE strips, one per edge, each scaled to a single row.
    //
    // Not one downscale of the whole frame. Drawing 1920x1080 into a small square makes each
    // destination pixel the average of a 60x60 source block, so an "edge" sample is really
    // 60px of frame - and at the third stop that reaches into a dark globe and dragged the
    // page floor to rgb(204,202,206) against a measured border of #e6e6e4. Source rectangles
    // sample the actual border, which is what has to match the page.
    const T = Math.max(2, Math.round(VH * 0.012));     // a ~1.2% band, thin but not noisy
    try {
      gctx.drawImage(videoEl, 0, 0, VW, T, 0, 0, GS, 1);                 // top
      gctx.drawImage(videoEl, 0, VH - T, VW, T, 0, 1, GS, 1);            // bottom
      gctx.drawImage(videoEl, 0, 0, T, VH, 0, 2, 1, 1);                  // left
      gctx.drawImage(videoEl, VW - T, 0, T, VH, 1, 2, 1, 1);             // right
    } catch (e) {
      return null;                            // a frame not yet decoded
    }
    let d;
    try {
      d = gctx.getImageData(0, 0, GS, 4).data;
    } catch (e) {
      return null;                            // a tainted canvas
    }
    const px = [];
    const take = (x, y) => {
      const k = (y * GS + x) * 4;
      px.push([d[k], d[k + 1], d[k + 2]]);
    };
    for (let x = 0; x < GS; x++) { take(x, 0); take(x, 1); }
    take(0, 2); take(1, 2);
    if (!px.length) return null;
    // The FLOOR, not the mean. The mean is not the floor whenever the subject touches an
    // edge, and at the third stop the dome does: measured, the border mean there is
    // rgb(206,203,208) against a floor of rgb(236,236,233), so a page tracking the mean
    // turned mid-grey. Sorting by luminance and taking the 50th to 90th percentile drops
    // the subject at the bottom and any specular highlight at the top; measured across all
    // five filmed stops that band lands on the studio floor every time.
    px.sort((a, b2) => (0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2])
                     - (0.299 * b2[0] + 0.587 * b2[1] + 0.114 * b2[2]));
    const lo = Math.floor(px.length * 0.50), hi = Math.max(lo + 1, Math.floor(px.length * 0.90));
    let r = 0, g = 0, b = 0;
    for (let i = lo; i < hi; i++) { r += px[i][0]; g += px[i][1]; b += px[i][2]; }
    const n = hi - lo;
    return [r / n, g / n, b / n];
  }

  const BASE_GROUND = (function () {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim();
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [232, 233, 231];
  })();

  let lastSample = null;
  let groundWritten = false;
  let groundDirty = true;

  function syncGround(filmVis, now) {
    // Sampling every frame is wasted work - the floor of a clay render moves over seconds,
    // not over 16 ms - and getImageData is the one call here that can stall a frame. So it
    // is throttled, but `groundDirty` overrides the throttle: a seek means the frame under
    // the sample has changed, and a throttle alone will park before it notices.
    let want = BASE_GROUND;
    let pending = false;
    if (filmVis > 0.5) {
      if (groundDirty || now - groundAt > 90) {
        groundAt = now;
        const s = sampleGround();
        if (s) { lastSample = s; groundDirty = false; }
      }
      // Still waiting on a decodable frame. Reported as movement so the chain stays alive
      // rather than parking on a colour taken from a frame that is no longer up.
      pending = groundDirty;
      if (lastSample) want = lastSample;
    }
    if (!ground) ground = want.slice();
    // Eased, not written: a cut between two near-whites is more visible than the seam it is
    // there to remove, because the eye catches the whole page changing at once.
    const k = reduce ? 1 : 0.12;
    let moved = false;
    for (let c = 0; c < 3; c++) {
      const d = want[c] - ground[c];
      if (Math.abs(d) > 0.4) moved = true;
      ground[c] += d * k;
    }
    if (moved || !groundWritten) {
      groundWritten = true;
      document.documentElement.style.setProperty('--bg',
        'rgb(' + ground.map((c) => Math.round(c)).join(',') + ')');
    }
    return moved || pending;
  }
  let liveStop = 0;
  // How far each full-width band's panel has travelled through its own band. Kept out of
  // the stylesheet because the panel's transform is written inline every frame, and an
  // inline transform beats any rule that tries to add to it.
  const bandTravel = [];
  let liveStep = 0;
  let sayT = 0;
  let filmVis = 0;

  function paintCopy(pos) {
    let nearD = Infinity, nearI = liveStop;
    const vises = [];
    // Hoisted. innerHeight was being read once per section, every frame, after `centres`
    // was cached for exactly that reason.
    const H = vh();
    // How much of each stage layer is wanted right now. Taken from the panels' own fade
    // curve rather than from a second one, so a layer is never still up under copy that has
    // gone, and never absent under copy that is fully lit.
    const roleVis = { logo: 0, film: 0, art: 0, none: 0 };
    /* Which panel is winning, decided BEFORE any of them is painted. The curve below caps
       every other panel at the light this one leaves spare, and a cap cannot be applied in
       the same pass that discovers what it is. Only the distance matters here, so this is
       one subtraction per section and no layout read. */
    let leadStop = 0;
    let leadVis = 0;
    for (let i = 0; i < N; i++) {
      const dd = Math.abs(pos - centrePx(i)) / (bands[i] * H * 0.5);
      const v = dd <= 0.96 ? 1 : 1 - smooth(Math.min(1, (dd - 0.96) / 0.10));
      if (v > leadVis) { leadVis = v; leadStop = i; }
    }
    for (let i = 0; i < N; i++) {
      const s = S[i];
      const c = centrePx(i);
      const half = bands[i] * H * 0.5;
      const d = Math.abs(pos - c) / half;            // 0 at the stop, 1 at the band edge
      // A pinned panel taller than the viewport hides its own tail: the reader scrolls,
      // the panel does not move, and the last cards and the callout are unreachable. On
      // the full-width bands the panel therefore TRAVELS through its band, by exactly the
      // amount it overflows, so everything in it passes the screen once.
      if (s.block === 'band') {
        const pan = panels[i];
        if (pan) {
          const spill = spillOf(i);
          // The travel finishes at 72% of the band, not at its edge: the panel starts
          // fading out near the edge, so a tail that only arrives there is read through
          // a half-faded panel. Finishing early means the last card and the callout are
          // fully lit and stationary for the rest of the band.
          const RUN = 0.72;
          /* The travel has to begin where the reader can actually BE.
             `pos` is the viewport CENTRE, so its smallest possible value is half a
             viewport: for the first stop, whose band starts at 0, a third of the band is
             at scroll positions that do not exist. The panel was therefore already part
             way through its travel on the first frame. Measured on samples.html at 1600x900
             once it became the opening stop: at scrollY 0 the panel was translated -260px
             and its heading sat 164px above the top of the screen, unreachable at any
             scroll position on the page.
             Clamping the start to the first reachable position costs nothing anywhere else
             - for every other stop `c - half` is already past half a viewport, so this is
             identity - and it does not move where the travel finishes. */
          /* The travel starts 40% INTO the band, not at its leading edge.
             At the edge the panel is only about two thirds lit - the fade has not finished -
             so a panel that starts travelling there has already moved its head off the top
             of the screen by the time it is readable. Every jump into a tall stop therefore
             arrived part way down a grid of tiles with the heading gone: measured on the
             pairs stop of the samples page, 983px down on a click and still 113px down after
             the landing was corrected.
             Holding still for the first 40% costs nothing - the reader is arriving, and the
             band is fitted to the content either way - and it means the stop can be entered
             at a position where the panel is fully lit AND untravelled, which is what
             landingPx() now targets. */
          const from = Math.max(c - half * 0.6, vh() / 2);
          const to = (c - half) + 2 * half * RUN;
          const prog = to > from
            ? Math.max(0, Math.min(1, (pos - from) / (to - from)))
            : 0;
          bandTravel[i] = spill > 8 ? -spill * prog : 0;
        }
      }
      // HOLD, then a short dissolve. Not a curve that starts falling immediately.
      //
      // `d` is 0 at the stop and 1 at the band edge. The previous shape held full strength
      // only to d = 0.12 and then decayed the whole rest of the way, so a reader spent
      // about 12% of each band looking at fully-lit text and the other 88% watching it
      // fade - which is what "the scroll fade is too much, the text is barely visible"
      // describes. Now it is the other way round: solid to d = 0.70, which is 70% of the
      // band, and the dissolve happens in the last 30%.
      //
      // END > 1 on purpose. At exactly 1 the two neighbouring bands would meet at zero and
      // the screen would go blank between every pair of stops - eleven windows and 10.6% of
      // the page, measured, before this was found. Overlapping them means the outgoing and
      // incoming panels cross at half strength instead, which is a dissolve rather than a
      // cut, and the film underneath never blinks.
      // END 1.12, not 1.30. At 1.30 two panels crossed at half strength each and the
      // handover read as double-exposed text - two paragraphs superimposed. They can cross
      // much lighter now WITHOUT the screen emptying, because the film no longer rides this
      // curve: it holds at full opacity across the whole filmed span, so there is always a
      // picture there even at the instant the text is changing over.
      // HOLD 0.90, not 0.70. Measured on the split pages: 32% of the story page was
      // mid-dissolve at any given scroll position, and the longest stretch a reader could
      // read without something moving was about three screens. A dissolve is a cost paid
      // for continuity, and the cost was being paid over nearly a third of the page. At
      // 0.90 the panel is solid for the first 90% of its band and the handover happens in
      // the last 10%, which is where the reader is leaving anyway.
      /* 0.94, up from 0.90. The dissolve is what makes the page continuous, but it is
         also what a reader trying to FOLLOW a section experiences as the text going soft
         under them. At 0.94 a panel is solid for 94% of its band and hands over in the
         last 6%, which is the part the reader is leaving anyway. */
      /* 0.96 / 1.06, tightened again from 0.94 / 1.10. The two constants set how far apart
         the outgoing and incoming panels are when they pass each other, and at 0.94 / 1.10
         they passed at 0.68 opacity EACH - not a dissolve, two pages printed on top of one
         another. Photographed on the samples page: "Nine conversation types" was legible
         straight through three enterprise call tiles. It shows up on a band and not on a
         prose stop because a band's panel is dense edge to edge, so there is no quiet part
         of the screen for the other one to cross in.
         Now they pass at 0.5 each, and the window they do it in is 0.10 of a band rather
         than 0.16 - about a tenth of a screen of scroll on a short stop, which is short
         enough to read as a handover rather than as an overlay. Still not a cut: END stays
         above 1, so the screen never empties between two stops. */
      const HOLD = 0.96, END = 1.06;
      let vis = d <= HOLD ? 1 : 1 - smooth(Math.min(1, (d - HOLD) / (END - HOLD)));
      /* NO PANEL MAY BE BRIGHTER THAN WHAT THE ONE IN FRONT LEAVES SPARE.
         `d` is a fraction of the band, so two neighbouring stops of DIFFERENT lengths do
         not cross symmetrically: the shorter band's fraction runs out first and its panel
         is already well into its fade while the longer one is still nearly solid. Measured
         after tightening the curve, the second-brightest panel still reached 0.60 on the
         experience and results pages while the brightest was near 0.9 - the ghost this was
         meant to remove, just at a different pair of stops.
         Capping every other panel at the light the leader leaves over fixes it for any pair
         of band lengths without touching the curve: at the true crossover both are 0.5 and
         nothing changes, and anywhere either one is winning, the loser is pushed down to
         what is genuinely left. */
      if (i !== leadStop) vis = Math.min(vis, 1 - leadVis);
      // The opening statement does not fade IN. At scrollY = 0 the reader is a full band
      // above the first stop, so the curve above put the page's own headline on screen at
      // 0.175 opacity - 1.44:1 against the ground, and a ghost-grey first impression. It
      // fades out normally once the camera is past it; only the approach is floored.
      if (i === 0 && pos <= c) vis = 1;
      vises[i] = vis;
      roleVis[roleOf(s)] = Math.max(roleVis[roleOf(s)], vis);
      // Each world name rides its own section's curve, so consecutive world stops dissolve
      // into one another instead of swapping in a frame. The slide is the same 34px the
      // copy panel opposite uses, in the same direction, so the two halves move together.
      if (marks[i]) {
        marks[i].style.opacity = vis.toFixed(3);
        marks[i].style.transform = reduce ? 'none'
          : `translate3d(0, ${((1 - vis) * (pos > c ? -34 : 34)).toFixed(1)}px, 0)`;
        marks[i].hidden = vis <= 0.004;
      }
      const p = panels[i];
      p.style.opacity = vis.toFixed(3);
      /* The world's NAME fades faster than the panel it sits in.
         ---------------------------------------------------------------------------
         Adjacent world stops draw their name in the same place, so during a handover
         both were legible at once and read as one name printed over another - measured
         at two scroll positions, Travel over Insurance and Insurance over Logistics,
         within 22px of each other. A body of numbers can dissolve into the next; a
         single large word cannot, because the eye reads both. The name only appears
         once its own panel is most of the way in. */
      p.style.setProperty('--namevis',
        Math.max(0, Math.min(1, (vis - 0.72) / 0.28)).toFixed(3));
      // Published so anything inside the panel that wants to arrive WITH the scroll can,
      // instead of firing a wall-clock transition on arrival. Eased past the halfway point
      // so a chart is at full length by the time the panel is fully lit rather than still
      // filling as it starts to leave.
      p.style.setProperty('--grow', Math.min(1, vis * 1.9).toFixed(3));
      const trav = bandTravel[i] || 0;
      p.style.transform = reduce
        ? (trav ? `translate3d(0, ${trav.toFixed(1)}px, 0)` : 'none')
        : `translate3d(0, ${(((1 - vis) * (pos > c ? -12 : 12)) + trav).toFixed(1)}px, 0)`;
      // Operable exactly as long as it is legible. These used to be two different
      // thresholds - inert below 0.55, painted until 0.002 - which left a wide band where a
      // sighted reader could see a perfectly readable "Project page" button, click straight
      // through it, and get nothing, while assistive technology could not see it at all.
      const live = vis > 0.14;
      p.style.pointerEvents = live ? 'auto' : 'none';
      p.inert = !live;
      /* If focus was inside a panel that just went dead, park it somewhere real rather than
         letting the browser drop it to <body> with no announcement. It used to go to that
         panel's rail dot, but every page here sets rail:false, and the sheet hides a hidden
         rail with display:none - focus() on a display:none element is a silent no-op, so
         the rescue produced exactly the outcome it exists to prevent. The panel arriving on
         screen is the honest destination; it is about to be the only thing readable. */
      if (!live && p.contains(document.activeElement)) {
        const dot = dots[i];
        if (dot && dot.offsetParent !== null) dot.focus();
        else { root.tabIndex = -1; root.focus({ preventScroll: true }); }
      }
      p.hidden = vis <= 0.002;

      // In video mode the chain already shows each globe full-frame, so the floating
      // tile would be the same object twice on screen.
      const tile = videoOK ? null : tiles[i];
      if (tile) {
        // The globe rises into place and settles, then sinks as the camera leaves.
        const tv = Math.max(0, 1 - Math.pow(Math.max(0, d - 0.05) / 0.85, 1.6));
        tile.style.opacity = tv.toFixed(3);
        const rise = (1 - tv) * 40;
        const sc = 0.86 + tv * 0.14;
        tile.style.transform =
          `translate3d(-50%, calc(-50% + ${rise.toFixed(1)}px), 0) scale(${sc.toFixed(3)})`;
        tile.hidden = tv <= 0.002;
      }
      globes.forEach((g) => {
        if (g.__stop !== i) return;
        // Only on a change. Writing aria-current eighteen times a frame to set it to the
        // value it already had was 17 setAttribute calls per frame for nothing.
        const on = d < 0.5;
        if (g.classList.contains('is-on') !== on) {
          g.classList.toggle('is-on', on);
          g.setAttribute('aria-current', on ? 'true' : 'false');
        }
      });
      // NEAREST, not "inside a half-band". The two used to be the same test, and it
      // capped the reveal at a quarter of the band: the ramp could only run while d < 0.5,
      // and it had to finish AT the stop or a rail click landed part-way through it and
      // hid half the evidence. Tracking the nearest section instead frees the ramp to start
      // as soon as this stop is the one being approached, so four steps get 42% of the band
      // rather than 25% and still complete on arrival.
      if (d < nearD) { nearD = d; nearI = i; }
      const dotOn = d < 0.5;
      if (dots[i].classList.contains('is-on') !== dotOn) {
        dots[i].classList.toggle('is-on', dotOn);
        dots[i].setAttribute('aria-current', dotOn ? 'true' : 'false');
      }
    }
    // The live stop, and how far into its staged reveal the reader has come.
    if (liveStop !== nearI) {
      /* Re-measure the arriving panel's overflow. The cached value is taken the first time
         the panel is measurable, which is part-way through the approach - before the card
         grid has settled to its final column count, and while the panel is still taller
         than it will end up. Locking that in made the nine-card section travel 409px to
         cover 155px of overflow, so the last card ended a third of a screen above the fold
         with dead space under it. Once per stop change is not a hot path. */
      spills[nearI] = null;
      /* WHERE A SHORT BAND PANEL SITS.
         The copy column pads 96px off the top of the screen and the panel hangs from there,
         which is right for a panel that overflows - it has to start at the top or its tail
         never arrives. For one that FITS it is just a panel in the top half of the screen
         with a third of the viewport empty underneath: measured on the samples page, every
         stop left between 232 and 306 pixels of nothing below the content, at every scroll
         position, on a 757px screen.
         So a panel that fits is centred instead, and one that does not keeps the top pad it
         needs. Written on the stop change rather than per frame, and as a custom property
         rather than a style on the panel, because the panel's own transform is rewritten
         every frame by the travel. */
      syncBandPad(nearI);
    }
    liveStop = nearI;
    {
      const s = S[liveStop], c = centrePx(liveStop), half = bands[liveStop] * H * 0.5;
      const steps = s.steps || 0;
      if (steps > 1) {
        const raw = Math.max(0, Math.min(1, (pos - (c - half)) / (half * 2)));
        // Over the approach, raw 0.08 to 0.50, so the last step lands exactly on the stop
        // and holds through it. Both bounds have been wrong before, in opposite ways:
        // centred, the stop itself sat on step 2 of 4 and anyone arriving by a rail dot saw
        // three of the six walks with no sign the rest existed; run past the stop, the same
        // thing happened again from the other side.
        const p = Math.max(0, Math.min(0.999, (raw - 0.08) / 0.42));
        liveStep = Math.min(steps - 1, Math.floor(p * steps));
      } else {
        liveStep = 0;
      }
    }

    if (root.dataset.block === 'summary') publishHole();
    if (navItems.length && openEl) {
      const past = pos - vh() / 2 > openEl.offsetHeight * 0.55;
      if (root.dataset.past !== String(past)) {
        root.dataset.past = String(past);
        navItems.forEach((b) => {
          const on = b.__from >= 0 && past && liveStop >= b.__from && liveStop <= b.__to;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-current', on ? 'true' : 'false');
        });
      }
    }

    // The stage layers. `hidden` below a hair of opacity rather than merely transparent: a
    // 39 MB video left painted under a stop that does not use it still costs a composite and
    // a decode every frame, and the mark's text would still be found by a page search.
    const layer = (node, v) => {
      node.style.opacity = v.toFixed(3);
      node.hidden = v <= 0.004;
    };
    layer(logoWrap, roleVis.logo);
    artImgs.forEach((im, k) => { if (im) layer(im, vises[k]); });
    // The film HOLDS across the whole filmed span rather than riding each section's fade.
    // Taking the max of the per-section curves meant it dipped between every pair of filmed
    // stops, so the one element that is meant to be continuous was the one blinking. It
    // ramps only at the two ends, where there genuinely is no film to show.
    if (FILMED.length) {
      const fi = FILMED[0], li = FILMED[FILMED.length - 1];
      const first = centrePx(fi), last = centrePx(li);
      const half = H * 0.5;
      // The ramp is only for film that has to appear from somewhere. When the FIRST section
      // is itself filmed there is nothing before it to appear from, and ramping anyway put
      // the picture at 19% opacity at the very top of the page - the one frame every reader
      // sees first. Same at the other end.
      roleVis.film =
        (pos >= first || fi === 0) && (pos <= last || li === N - 1) ? 1
        : Math.max(0, 1 - (pos < first ? (first - pos) : (pos - last)) / Math.max(1, half * 1.6));
    }
    // A section that asks for NO backdrop suppresses whatever the neighbours would have
    // put there. Without this the film kept whatever opacity the next stop's fade gave it
    // and was painted at partial strength behind the opening matrix - a diorama printed
    // through the abstract.
    const off = Math.max(roleVis.none, roleVis.art);
    if (off > 0) roleVis.film *= Math.max(0, 1 - off);
    filmVis = roleVis.film;
    // The COMPUTED backdrop obeys the stage roles too. It only ever needed to in the export,
    // where the film config is stripped and this is the backdrop - and there it was showing
    // at all twelve stops, including the four that want nothing on the left, because the
    // only rule that hid it was `.fw-has-video .fw-hero`, which never matched without a
    // video. That is why the single-file build had the whole diorama printed under the
    // abstract and under every results table.
    if (heroWanted && !videoOK) {
      heroImg.style.opacity = roleVis.film.toFixed(3);
      heroImg.hidden = roleVis.film <= 0.004;
    }
    if (videoEl) {
      // Not `hidden`. The film has to keep decoding through a stop that does not show it, or
      // the next filmed stop opens on a stale frame while the decoder catches up.
      videoEl.style.opacity = roleVis.film.toFixed(3);
    }
    // The mark's travel from small-and-centred to large-and-left. One number, interpolated
    // over the same bands as everything else; the sheets decide what it means, which is how
    // the stacked shell can decline to move it at all.
    document.documentElement.style.setProperty('--logo-t',
      scalarAt(pos, 'logoT', 1).toFixed(4));

    if (root.dataset.stop !== String(liveStop)) {
      root.dataset.stop = String(liveStop);
      root.dataset.stage = roleOf(S[liveStop]);
      // What KIND of evidence this stop carries, so the sheets can budget space for it.
      // The stage role says what is on the left; this says what is on the right, and they
      // are not the same question: three stops share stage "film" and want three different
      // splits, because six live maps need room a paragraph does not.
      // An explicit `block` wins: the closing stop has no content to classify by, and it is
      // the one stop whose layout is different from every other.
      // A band that is a WORLD keeps the film, as a banner above its results. Marked
      // separately from the block so the other bands - the matrix, the violins, the small
      // multiples - stay clean.
      root.dataset.plate = S[liveStop].plate ? '1' : '';
      root.dataset.block = S[liveStop].block ? S[liveStop].block
        : S[liveStop].summary ? 'summary'
        : S[liveStop].runs ? 'runs'
        : S[liveStop].maps ? 'maps'
        : S[liveStop].pillars ? 'table'
        : S[liveStop].bars ? 'bars' : 'text';
      // Marks the panel the flight has actually arrived at, which is what the bars grow
      // from. Set here rather than in the per-section loop: that runs every frame, and
      // writing a class thirteen times a frame to change nothing is how a scroll page ends
      // up dropping them.
      panels.forEach((pp, k) => pp.classList.toggle('is-live', k === liveStop));
      // Nothing is current while the opening is still the screen: it is not a section, and
      // lighting the first entry there tells the reader they are somewhere they are not.
      const past = !openEl || window.scrollY > openEl.offsetHeight * 0.55;
      navItems.forEach((b) => {
        const on = past && liveStop >= b.__from && liveStop <= b.__to;
        if (b.classList.contains('is-on') !== on) {
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-current', on ? 'true' : 'false');
        }
      });
      // Unconditionally, including the very first paint: a reader who reloads part-way down
      // is restored by the browser straight onto whatever stop they were on, and skipping
      // this on the first frame would leave that stop's walks permanently empty.
      mapsOnStopChange(liveStop);
      runsOnStopChange(liveStop);
      tapesOnStopChange(liveStop);
      // Only on a stop change: writing this every frame would relayout the film continuously.
      if (SHELL === 'stacked' && filmPx[liveStop]) {
        document.documentElement.style.setProperty('--film', filmPx[liveStop] + 'px');
      }
      // The film's box can change with the stop - the split shell widens it at a table stop
      // - so the plate's anchor has to be re-read. After a frame, so the new width is the
      // one that gets measured rather than the one being replaced.
      requestAnimationFrame(() => { publishHole(); publishFilmBox(); });
      // All five panels share one grid cell in one scroll container, so a column that had to
      // scroll at the previous stop hands its offset to the next one, which then opens
      // part-way down its own copy.
      if (copyWrap.scrollTop) copyWrap.scrollTop = 0;
      // Debounced. `polite` QUEUES, so a two-second fling down the page enqueued all
      // twelve labels and the reader heard them minutes behind their own scrolling.
      // Announced only once the flight has actually settled somewhere.
      clearTimeout(sayT);
      sayT = setTimeout(() => {
        status.textContent = (S[liveStop] && S[liveStop].label) || '';
      }, 450);
    }
    if (root.dataset.step !== String(liveStep)) root.dataset.step = String(liveStep);
    hint.style.opacity = pos < H * 0.75 ? '1' : '0';
  }

  // Scroll position -> a time in the rendered chain. Same band/centre geometry as
  // cameraAt, so a stop lands on its clip's tight shot and the space between two stops
  // plays the connector that was rendered for exactly that pair.
  // The sections that are actually filmed, in order. Everything below walks THIS list rather
  // than the section list, so an unfilmed stop between two filmed ones simply lengthens the
  // leg that spans it instead of demanding a frame nobody rendered.
  const FILMED = VID ? VID.stops.map((t, i) => i).filter((i) => VID.stops[i] !== null &&
                                                               VID.stops[i] !== undefined) : [];

  function timeAt(pos) {
    const T = VID.stops;
    const F = FILMED;
    const last = F[F.length - 1];
    if (pos >= centrePx(last)) return T[last];
    if (pos <= centrePx(F[0])) {
      // Lead-in: ease from the first frame of the film up to the first filmed stop, rather
      // than freezing on it. Scroll does something immediately.
      const head = centrePx(F[0]) - vh() / 2;   // scroll distance to the first filmed stop
      if (head <= 0) return T[F[0]];
      const k = Math.max(0, Math.min(1, (pos - vh() / 2) / head));
      return T[F[0]] * k;
    }
    let k = 0;
    while (k < F.length - 2 && pos > centrePx(F[k + 1])) k++;
    const i = F[k], j = F[k + 1];
    const a = centrePx(i), b = centrePx(j);
    const raw = (pos - a) / (b - a);
    if (reduce) return T[raw < 0.5 ? i : j];
    // `linger` was being honoured by the computed camera and silently ignored here, so the
    // one knob meant for holding a stop did nothing on the page people actually see.
    // `lingered` applies smoothstep itself, so passing it smooth(raw) eased the film TWICE
    // and the within-leg speed swung about 20 to 1 - measured peak/average 1.8 against the
    // 1.5 a single smoothstep gives. A hold is right for the camera, where settling on a
    // subject is the point; on currentTime a hold is a frozen frame followed by a sprint.
    let t = lingered(raw, (S[i].linger || 0) * 0.5 + (S[j].linger || 0) * 0.5);
    // `pace` reshapes how film time is spent ACROSS a leg, which linger cannot do: linger
    // slows both ends symmetrically, pace decides whether the seconds go to the beginning
    // of the shot or the end. Above 1 the film crawls early and catches up late, which is
    // what an establishing shot needs - the subject is only on screen for the first tenth
    // of the leg, so an even spend blows past it in two wheel notches.
    const pace = S[i].pace || 1;
    if (pace !== 1) t = Math.pow(t, pace);
    // Opening leg only. smoothstep is flat at both ends and pace exaggerates it, which at
    // the top of the page reads as the thing having hung. The domain legs are left exactly
    // as they are - their pacing is right and a global floor would speed all of them up.
    if (k === 0) {
      const FLOOR = 0.25;
      t = FLOOR * raw + (1 - FLOOR) * t;
    }
    return T[i] + (T[j] - T[i]) * t;
  }

  let curT = null;
  let seekBusy = false;
  let seekQueued = null;
  let seekAt = 0;
  let lastWritten = null;

  function drawVideo(pos, instant) {
    const want = timeAt(pos);
    if (!Number.isFinite(want)) return false;
    // Follow rather than snap, for the same reason the camera does: wheel deltas are
    // coarse and writing them straight to currentTime reads as a stutter.
    curT = (!Number.isFinite(curT) || reduce || instant) ? want : curT + (want - curT) * 0.22;
    // Sub-frame writes are wasted work - the decoder cannot show them and each seek
    // costs. One frame at 24fps is ~0.042s.
    // A seek that neither completes nor errors - a stalled blob read, a superseded range
    // request, a target past duration - would otherwise hold the latch for ever, and from
    // then on every write is merely queued: the film freezes on its last frame while the
    // copy carries on painting, with nothing in the console. 35 aborted media reads were
    // measured during one backward pass, which is exactly that class of event.
    if (seekBusy && (!videoEl.seeking || performance.now() - seekAt > 500)) seekBusy = false;
    if (lastWritten === null || Math.abs(curT - lastWritten) > 0.02) {
      lastWritten = curT;
      if (seekBusy) {
        seekQueued = curT;             // coalesce: only the newest target matters
      } else {
        seekBusy = true;
        seekAt = performance.now();
        try { videoEl.currentTime = curT; } catch (e) { seekBusy = false; }
      }
    }
    return Math.abs(want - curT) > 0.01;
  }

  let lastFrac = 0;
  let restoring = false;
  let firstLayout = true;
  let lastSbw = -1;

  function frame(instant) {
    // Cancel any callback already scheduled. Assigning `raf = 0` on the way out is not
    // enough: a callback can still be pending at that moment, and onScroll only tests
    // `if (!raf)`, so a second chain could start and both would then run every frame, each
    // writing currentTime and repainting the copy.
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    const pos = window.scrollY + vh() / 2;
    // Where the reader is in the story, as a fraction, so a resize can put them back.
    if (!restoring) lastFrac = pos / Math.max(1, totalPx());

    if (videoOK) {
      const moving = drawVideo(pos, instant);
      paintCopy(pos);
      // The ground keeps the chain alive on its own: it eases over about half a second, and
      // parking the loop the instant the film stops seeking would freeze it part-way there,
      // leaving a page floor that is neither the film's nor the sheet's.
      const settling = syncGround(filmVis, performance.now());
      raf = ((moving || settling) && !instant && !reduce)
        ? requestAnimationFrame(() => { raf = 0; frame(false); }) : 0;
      return;
    }

    target = cameraAt(pos);
    if (!cur || instant || reduce) {
      cur = { ...target };
    } else {
      // A light exponential follow. Scroll wheels arrive in coarse steps; without
      // this the camera steps with them instead of gliding.
      const k = 0.18;
      cur.x += (target.x - cur.x) * k;
      cur.y += (target.y - cur.y) * k;
      cur.z += (target.z - cur.z) * k;
    }
    draw(cur);
    paintCopy(pos);
    // Only if the film once drove the floor. On a page that never had one, --bg is whatever
    // the sheet says and writing an identical rgb() over it every frame is pure churn.
    const settling = groundWritten && syncGround(0, performance.now());

    const moving = settling || (!instant && !reduce &&
      (Math.abs(target.x - cur.x) > 1e-4 || Math.abs(target.y - cur.y) > 1e-4 ||
       Math.abs(target.z - cur.z) > 1e-4));
    // The scheduled callback clears `raf` itself. Assigning it here alone meant frame(true)
    // - which layout() and the video error handler both call - could zero it while a
    // callback from onScroll was still pending, so the next scroll event started a SECOND
    // chain and both then ran every frame, each writing currentTime and repainting the copy.
    raf = moving ? requestAnimationFrame(() => { raf = 0; frame(false); }) : 0;
  }

  function onScroll() {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; frame(false); });
  }

  // Ignore height-only resizes: on a phone that is just the URL bar collapsing,
  // and relaying out on it makes the page jump under the reader's thumb.
  let lastW = vw();
  function onResize() {
    if (vw() === lastW && matchMedia('(hover: none)').matches) return;
    lastW = vw();
    layout();
  }

  // --------------------------------------------------------------- autoplay
  // Hands-off cinematic mode: the page scrolls itself at a steady rate so the flight can
  // run unattended in a room. It is a real scroll, not a separate animation path, so the
  // camera, the copy, the rail and the world index all stay driven by exactly the same
  // code as a human wheel - there is no second timeline that can drift out of agreement.
  // `?autoplay=1` starts it on load, for leaving the page running in a room unattended.
  const AUTO = Object.assign({ seconds: 105, start: false, loop: true },
                             config.autoplay || {});
  try {
    if (new URLSearchParams(location.search).has('autoplay')) AUTO.start = true;
  } catch (e) { /* file:// with no search is fine */ }
  let auto = false;
  let autoRaf = 0;
  let autoPrev = 0;
  let autoPos = 0;
  let autoHold = 0;

  const autoBtn = el('button', 'fw-auto');
  autoBtn.type = 'button';
  autoBtn.innerHTML = '<span class="fw-auto-icon"></span><span class="fw-auto-text"></span>';
  const autoText = autoBtn.querySelector('.fw-auto-text');

  function autoLabel() {
    autoText.textContent = auto ? 'Pause' : 'Play';
    autoBtn.setAttribute('aria-label', auto ? 'Pause the flight' : 'Play the flight');
    autoBtn.setAttribute('aria-pressed', auto ? 'true' : 'false');
    autoBtn.classList.toggle('is-on', auto);
  }

  function autoStop() {
    if (!auto) return;
    auto = false;
    if (autoRaf) cancelAnimationFrame(autoRaf);
    autoRaf = 0;
    autoLabel();
  }

  function autoStep(ts) {
    if (!auto) return;
    const dt = autoPrev ? Math.min(0.05, (ts - autoPrev) / 1000) : 0;
    autoPrev = ts;
    const end = Math.max(1, totalPx() - vh());
    if (autoHold > 0) {
      // A beat on the closing frame before the rewind, so the last stop is not snatched away.
      autoHold -= dt;
      if (autoHold <= 0) {
        autoPos = 0;
        window.scrollTo({ top: 0, behavior: 'instant' });
      }
    } else {
      // Fractional accumulator: at this cadence a frame is well under one pixel, and
      // scrollBy would round every one of them to zero and never move.
      autoPos += (end / AUTO.seconds) * dt;
      if (autoPos >= end) {
        autoPos = end;
        window.scrollTo({ top: end, behavior: 'instant' });
        if (!AUTO.loop) { autoStop(); return; }
        autoHold = 2.2;
      } else {
        // 'instant' is load-bearing: the sheet sets scroll-behavior:smooth on <html>, and a
        // two-argument scrollTo resolves behavior:auto to that CSS value. Every one of these
        // per-frame writes was therefore STARTING a smooth animation and retargeting it on
        // the next frame, so the constant rate the accumulator computes never happened.
        window.scrollTo({ top: autoPos, behavior: 'instant' });
      }
    }
    autoRaf = requestAnimationFrame(autoStep);
  }

  function autoStart() {
    if (auto) return;
    auto = true;
    autoPrev = 0;
    autoHold = 0;
    autoPos = window.scrollY;
    autoLabel();
    autoRaf = requestAnimationFrame(autoStep);
  }

  autoBtn.addEventListener('click', () => (auto ? autoStop() : autoStart()));
  stage.appendChild(autoBtn);
  autoLabel();

  // Any deliberate input takes the wheel back. Scroll itself is NOT in this list, because
  // autoplay scrolls, and listening for it would stop the moment it started.
  ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach((ev) => {
    window.addEventListener(ev, (e) => {
      // Every event, not just pointerdown. keydown fires before click, so Space or Enter on
      // the focused Pause button stopped playback and then the click handler saw auto=false
      // and started it again; touchstart did the same on a tap. Autoplay was unstoppable by
      // anyone not using a mouse.
      if (autoBtn.contains(e.target)) return;
      autoStop();
    }, { passive: true });
  });

  if (AUTO.start && !reduce) autoStart();

  // ---------------------------------------------------------------- pointer
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    || (navigator.maxTouchPoints === 0 && !('ontouchstart' in window));
  if (config.cursor && finePointer && !reduce) {
    const halo = el('div', 'fw-cur fw-cur-halo');
    const core = el('div', 'fw-cur fw-cur-core');
    document.body.append(halo, core);
    root.classList.add('fw-has-cursor');
    let mx = innerWidth / 2, my = innerHeight / 2;
    let hx = mx, hy = my, cx = mx, cy = my;
    let over = false, curRaf = 0;
    const INTERACTIVE = 'a,button,[role="button"]';

    function tick() {
      // Two masses, deliberately different: the core all but keeps up, the halo drifts in
      // behind it. One element lagging alone reads as lag; two at different rates read as
      // something with weight following you.
      cx += (mx - cx) * 0.34;  cy += (my - cy) * 0.34;
      hx += (mx - hx) * 0.11;  hy += (my - hy) * 0.11;
      core.style.transform = `translate3d(${cx}px, ${cy}px, 0) translate(-50%, -50%)`;
      halo.style.transform =
        `translate3d(${hx}px, ${hy}px, 0) translate(-50%, -50%) scale(${over ? 1.85 : 1})`;
      const settled = Math.hypot(mx - hx, my - hy) < 0.4 && Math.hypot(mx - cx, my - cy) < 0.4;
      curRaf = settled ? 0 : requestAnimationFrame(tick);
    }
    window.addEventListener('pointermove', (e) => {
      mx = e.clientX; my = e.clientY;
      over = !!(e.target && e.target.closest && e.target.closest(INTERACTIVE));
      halo.classList.toggle('is-over', over);
      core.classList.toggle('is-over', over);
      if (!curRaf) curRaf = requestAnimationFrame(tick);
    }, { passive: true });
    window.addEventListener('pointerdown', () => halo.classList.add('is-down'));
    window.addEventListener('pointerup', () => halo.classList.remove('is-down'));
    document.addEventListener('pointerleave', () => {
      halo.style.opacity = '0'; core.style.opacity = '0';
    });
    document.addEventListener('pointerenter', () => {
      halo.style.opacity = ''; core.style.opacity = '';
    });
  }

  // The header shows a hairline only once something has passed under it, which is what
  // stops the bar looking like a box on a page that has not moved.
  const markScrolled = () => {
    document.documentElement.classList.toggle('is-scrolled', window.scrollY > 8);
    // Same listener, because the step buttons' enabled state is a pure function of scroll
    // position and adding a second passive listener for it would be a second wake-up per
    // scroll event for two boolean writes.
    stepSync();
  };
  window.addEventListener('scroll', markScrolled, { passive: true });
  markScrolled();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(() => { lastW = vw(); layout(); }, 120));

  if (heroWanted && !heroImg.complete) heroImg.addEventListener('load', layout);
  layout();
  /* The first stop never triggers the stop-CHANGE branch, because it is the stop the page
     opens on. Without this the opening band kept the 96px top pad and sat high on the
     screen while every other stop centred, which reads as the first stop being broken. */
  syncBandPad(liveStop);
  stepSync();

  return {
    layout,
    goto: (i) => window.scrollTo({ top: landingPx(i),
                                  behavior: reduce ? 'instant' : 'smooth' }),
    camera: () => ({ ...cur }),
    stops: N,
  };
}

// A small mark per vendor so the audience can see at a glance which family produced a run.
// Deliberately simplified glyphs, not the vendors' official lockups.
//
// Matched on the system names the paper uses in prose - vendor mark plus version alone -
// rather than on the API identifiers, so "Voice Think Fast" and "3.1-Flash-Live" resolve
// as well as `xai-realtime` and `gemini-3.1-flash-live-preview` do.
/* The vendors' own marks, as shipped in the paper.
   ---------------------------------------------------------------------------
   These were hand-drawn SVGs for a while and every one of them was wrong in a way that
   mattered: OpenAI was a ring with a dot in it, which is a record button, and it was the
   mark on two of the five systems. The real logos are in img/icons and this just picks
   the right file. Returned as markup because that is what the call sites already insert.

   `art:` handles are resolved the same way as every other image on the page, so the
   single-file export works too. */
const VENDOR_ICON = [
  [/nova|sonic|amazon|bedrock/, 'nova'],
  [/gemini|flash-live|google/, 'gemini'],
  [/xai|grok|think fast/, 'grok'],
  [/gpt|openai|realtime/, 'openai'],
];

/* One colour per system, matched on the same loose names vendorMark() matches on, so a
   display name from the paper and an API identifier from a payload both resolve. */
/* Which text colour survives on a system's own colour. Mint and orange are light enough
   that white on them is about 2.2:1; ink on them is over 8:1. */
function sysInk(name) {
  const m = String(name).toLowerCase();
  return (/mini/.test(m) && !/gemini/.test(m)) || /nova|sonic/.test(m) ? '#17171f' : '#ffffff';
}

/* The same five systems, in the darkened variants that are legible AS TEXT. sysColor's
   values are fills: drawn as a bar they are fine, set as a label they run to 2.18:1. */
function sysTextColor(name) {
  const m = String(name).toLowerCase();
  if (/gemini|flash-live/.test(m)) return 'var(--sys-gemini-t)';
  if (/mini/.test(m)) return 'var(--sys-mini-t)';
  if (/xai|grok|think fast/.test(m)) return 'var(--sys-grok-t)';
  if (/nova|sonic/.test(m)) return 'var(--sys-nova-t)';
  if (/openai|gpt|realtime/.test(m)) return 'var(--sys-gpt-t)';
  return 'var(--ink)';
}

function sysColor(name) {
  const m = String(name).toLowerCase();
  // Gemini is tested BEFORE mini, because "Gemini" contains "mini" and the naive order
  // painted Gemini-3.1-Flash-Live in the mini colour on every chart on the page.
  if (/gemini|flash-live/.test(m)) return 'var(--sys-gemini)';
  if (/mini/.test(m)) return 'var(--sys-mini)';
  if (/xai|grok|think fast/.test(m)) return 'var(--sys-grok)';
  if (/nova|sonic/.test(m)) return 'var(--sys-nova)';
  if (/openai|gpt|realtime/.test(m)) return 'var(--sys-gpt)';
  return 'var(--ink)';
}

// Two glyphs, drawn rather than typed, so the button is the same size in every font.
const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
  + '<rect x="7" y="5.5" width="3.6" height="13" rx="1"/>'
  + '<rect x="13.4" y="5.5" width="3.6" height="13" rx="1"/></svg>';

function vendorMark(model) {
  const m = String(model).toLowerCase();
  if (/not yet|none/.test(m)) {
    return '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none"'
      + ' stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 2"/></svg>';
  }
  for (const [re, name] of VENDOR_ICON) {
    if (re.test(m)) {
      const path = ICONS[name] || ('img/icons/' + name + '.webp');
      // artSrc() resolves through the export's inlined art table, which does not have to
      // carry every icon. An unresolved lookup returned '' and an <img src=""> is a broken
      // image to the document, so the literal path is the floor.
      const real = artSrc(path)[0] || path;
      return '<img class="fw-vmark" src="' + real + '" alt="" aria-hidden="true">';
    }
  }
  return '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.4"'
    + ' fill="currentColor"/></svg>';
}

/* Set by the page so the export can rewrite these the way it rewrites every other image:
   they are named inside a function rather than in the config, and the build only rewrites
   what it can see in the source. */
const ICONS = (typeof window !== 'undefined' && window.__DW_ICONS) || {};

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

/* Art with a raster fallback behind it.

   Every image on this page is WebP, and a browser that will not decode WebP does not fail
   quietly: Safari paints a question-mark box, so the page reads as broken rather than as
   plain. `make_fallbacks.py` writes a PNG (or, for the opaque poster, a JPEG) beside every
   .webp; this swaps to it on the first error and says so once, because a silent fallback is
   how a whole class of art quietly stops being the art that was designed.

   Deliberately an onerror swap rather than <picture>. <picture> would make the single-file
   export inline BOTH encodings of every image, which is 226 KB of duplicate art in a file
   whose entire reason to exist is that it can be emailed. */
let ART_WARNED = false;

/* `art:A3` -> [data URI, raster fallback data URI].

   The single-file export replaces every `img/x.webp` reference with one of these handles and
   ships one table of the actual bytes, because the same image is named more than once and
   inlining it per mention duplicated 473 KB of base64 into a file whose whole purpose is
   that it can be emailed. It is also the only way the fallback can survive the export: on a
   data: URI the `.webp -> .png` rewrite below matches nothing, so a derived fallback comes
   out identical to the source and the error handler bails on it immediately. */
function artSrc(ref) {
  const t = window.__DW_ART;
  if (!t || typeof ref !== 'string' || ref.slice(0, 4) !== 'art:') return [ref, null];
  const e = t[ref.slice(4)];
  return e ? [e[0], e[1] || null] : [ref, null];
}

function artImg(src, alt, cls) {
  const im = new Image();
  if (cls) im.className = cls;
  im.decoding = 'async';
  im.addEventListener('error', function onFail() {
    const alt2 = im.dataset.fallback;
    if (!alt2 || im.src.endsWith(alt2)) return;   // the fallback failed too; stop here
    if (!ART_WARNED) {
      ART_WARNED = true;
      console.warn('flight: WebP did not decode, falling back to raster art');
    }
    im.src = alt2;
  });
  // Assigned in this order on purpose: alt and the fallback have to be in place before the
  // load can fail, and an <img> that has alt but no src yet is still an image to assistive
  // technology and gets its alt text painted across the stage.
  if (alt !== null && alt !== undefined) im.alt = alt;
  const [real, packed] = artSrc(src);
  if (packed) im.dataset.fallback = packed;
  else if (typeof real === 'string' && /\.webp$/i.test(real)) {
    im.dataset.fallback = real.replace(/\.webp$/i, /poster/i.test(real) ? '.jpg' : '.png');
  }
  if (real) im.src = real;
  return im;
}
