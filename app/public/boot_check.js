
// Shows a splash when the app's module bundle can't even start, the one case services/errors.ts
// can't catch itself (it's part of that bundle, so it never runs either), and reports it, since
// nothing else can. Without this the loading screen just animates forever with no explanation.
// WARN Must stay ES5 (parseable by anything) and a same-origin file, not an inline <script> —
//      the CSP's script-src allows no inline scripts, so an inline copy silently never runs
;(function(){

    // Whether a failure has been reported yet (once per page load is all that's useful)
    var reported = false

    // The script that failed to load, if the browser said so (see the error listener below)
    var failed_script = ''

    // Report the failure the way services/errors.ts would, except from a crawler (see crawler_ua
    // there), whose failures are never actionable
    function report(message){
        if (reported || /bot\/|crawler|spider|lighthouse|\+https?:\/\//i.test(navigator.userAgent)){
            return
        }
        reported = true
        try {
            var request = new XMLHttpRequest()
            request.open('POST', '/api/report_error')
            request.setRequestHeader('Content-Type', 'application/json')
            request.send(JSON.stringify({
                severity: 'critical',
                message: 'Boot check: ' + message,
                // No query or fragment, and an invite link's token masked (see safe_url there)
                url: location.origin + location.pathname.replace(/(\/invite\/)[^/]+/, '$1~'),
                language: navigator.language,
                context: {source: 'boot_check'},
            }))
        } catch (error){
            // Never fail
        }
    }

    // Insert the splash (once), styled by errors.sss which Vite emits as a real stylesheet.
    // Only English, since the catalogs are part of the bundle that didn't start
    function show_splash(title, text, reload){
        if (document.querySelector('.fail-splash')){
            return
        }
        var container = document.createElement('div')
        container.className = 'fail-splash'
        var heading = document.createElement('h1')
        heading.textContent = title
        var paragraph = document.createElement('p')
        paragraph.textContent = text
        container.appendChild(heading)
        container.appendChild(paragraph)
        if (reload){
            var button = document.createElement('button')
            button.textContent = "Reload"
            button.onclick = function(){
                location.reload()
            }
            container.appendChild(button)
        }
        document.body.insertBefore(container, document.body.firstChild)
    }

    // The splash for a browser known to be too old
    function show_too_old(){
        show_splash("Sorry, your browser is too old",
            "Please update your browser or use another browser", false)
    }

    // No ES module support means the `type="module"` entry is simply skipped
    if (!('noModule' in document.createElement('script'))){
        show_too_old()
        report('no ES module support')
        return
    }

    // Unsupported syntax in the bundle (e.g. regex lookbehind before Safari 16.4) is a parse-time
    // SyntaxError, which Chromium and Firefox report here before any of the app executes. A
    // capture listener also sees a <script> element's own error event (which doesn't bubble),
    // which is all a failed fetch gives, and possibly all Safari gives for a parse error too.
    // Once errors.ts has loaded it flags itself and handles all errors from then on
    window.addEventListener('error', function(event){
        if (window.app_errors_ready){
            return
        }
        var target = event.target
        if (target && target.tagName === 'SCRIPT'){
            failed_script = target.src
        } else if (event.error instanceof SyntaxError){
            show_too_old()
            report(String(event.error) + ' at ' + event.filename + ':' + event.lineno)
        }
    }, true)

    // Module scripts always run before DOMContentLoaded, so if errors.ts (the bundle's first
    // import) hasn't flagged itself by then, the bundle never started, however the browser did
    // or didn't report why. Unknown cause, so the splash offers both remedies
    document.addEventListener('DOMContentLoaded', function(){
        if (window.app_errors_ready){
            return
        }
        show_splash("Sorry, Paper Bible couldn't start",
            "Please try reloading the page. If that doesn't help, your browser may be too old," +
            " so please update it or use another browser", true)
        report('the bundle never started'
            + (failed_script ? ' (failed: ' + failed_script + ')' : ''))
    })
})()
