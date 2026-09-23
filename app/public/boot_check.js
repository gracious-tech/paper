
// Shows the "browser too old" splash when the app's module bundle can't even start, the one case
// services/errors.ts can't catch itself (it's part of that bundle, so it never runs either).
// Without this the loading spinner just spins forever with no explanation.
// WARN Must stay ES5 (parseable by anything) and a same-origin file, not an inline <script> —
//      the CSP's script-src allows no inline scripts, so an inline copy silently never runs
;(function(){

    // Insert the splash (once), styled by errors.sss which Vite emits as a real stylesheet
    function show_too_old(){
        if (document.querySelector('.fail-splash')){
            return
        }
        document.body.insertAdjacentHTML('afterbegin',
            '<div class="fail-splash">' +
            '<h1>Sorry, your browser is too old</h1>' +
            '<p>Please update your browser or use another browser</p>' +
            '</div>')
    }

    // No ES module support means the `type="module"` entry is simply skipped
    if (!('noModule' in document.createElement('script'))){
        show_too_old()
        return
    }

    // Module support but unsupported syntax in the bundle (e.g. regex lookbehind before Safari
    // 16.4) is a parse-time SyntaxError, reported here before any of the app executes.
    // Once errors.ts has loaded it flags itself and handles all errors from then on
    window.addEventListener('error', function(event){
        if (!window.app_errors_ready && event.error instanceof SyntaxError){
            show_too_old()
        }
    })
})()
