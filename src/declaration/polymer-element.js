/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */
(function(scope) {

  // imports

  var extend = scope.extend;
  var apis = scope.api.declaration;

  // imperative implementation: Polymer()

  // specify an 'own' prototype for tag `name`
  function element(name, prototype) {
    //console.log('registering [' + name + ']');
    // cache the prototype
    prototypesByName[name] = prototype || {};
    // notify the registrar waiting for 'name', if any
    notifyPrototype(name);
  }

  // declarative implementation: <polymer-element>

  var prototype = extend(Object.create(HTMLElement.prototype), {
    createdCallback: function() {
      // fetch the element name
      this.name = this.getAttribute('name');
      // fetch our extendee name
      this.extends = this.getAttribute('extends');
      this.loadResources();
      this.registerWhenReady();
    },
    registerWhenReady: function() {
      // if we have no prototype, wait
      if (this.waitingForPrototype(this.name)) {
        return;
      }
      // TODO(sorvell): this establishes an element's place in line
      // so it's critical that this be done in proper order.
      // NOTE: polymer previously explicitly waited for extendee's to be
      // ready before extendors. This has been removed and is the user's 
      // responsibility.
      if (waitingForQueue(this)) {
        return;
      }
      if (this.waitingForResources()) {
        return;
      }
      this._register();
      /*
      var extendee = this.extends;
      if (this.waitingForExtendee(extendee)) {
        //console.warn(this.name + ': waitingForExtendee:' + extendee);
        return;
      }
      // TODO(sjmiles): HTMLImports polyfill awareness:
      // elements in the main document are likely to parse
      // in advance of elements in imports because the
      // polyfill parser is simulated
      // therefore, wait for imports loaded before
      // finalizing elements in the main document
      if (document.contains(this)) {
        whenImportsLoaded(function() {
          this._register(extendee);
        }.bind(this));
      } else {
        this._register(extendee);
      }
      */
    },
    _register: function() {
      //console.group('registering', this.name);
      this.register(this.name, this.extends);
      //console.groupEnd();
      // subclasses may now register themselves
      //notifySuper(this.name);
      notifyQueue(this);
    },
    waitingForPrototype: function(name) {
      if (!getRegisteredPrototype(name)) {
        // then wait for a prototype
        waitPrototype[name] = this;
        // if explicitly marked as 'noscript'
        if (this.hasAttribute('noscript')) {
          // TODO(sorvell): CustomElements polyfill awareness:
          // noscript elements should upgrade in logical order
          // script injection ensures this under native custom elements;
          // under imports + ce polyfills, scripts run before upgrades.
          // dependencies should be ready at upgrade time so register
          // prototype at this time.
          if (window.CustomElements && !CustomElements.useNative) {
            element(name);
          } else {
            var script = document.createElement('script');
            script.textContent = 'Polymer(\'' + name + '\');';
            this.appendChild(script);
          }
        }
        return true;
      }
    },
    waitingForResources: function() {
      return this._needsResources;
    }, 
    loadResources: function() {
      this._needsResources = this.preloadStyles(function() {
        this._needsResources = false;
        this.registerWhenReady();
      }.bind(this));
    }
    /*,
    waitingForExtendee: function(extendee) {
      // if extending a custom element...
      if (extendee && extendee.indexOf('-') >= 0) {
        // wait for the extendee to be registered first
        if (!isRegistered(extendee)) {
          (waitSuper[extendee] = (waitSuper[extendee] || [])).push(this);
          return true;
        }
      }
    }*/
  });

  // semi-pluggable APIs 
  // TODO(sjmiles): should be fully pluggable (aka decoupled, currently
  // the various plugins are allowed to depend on each other directly)
  Object.keys(apis).forEach(function(n) {
    extend(prototype, apis[n]);
  });

  // utility and bookkeeping
  /*
  function whenImportsLoaded(doThis) {
    if (window.HTMLImports && !HTMLImports.ready) {
      addEventListener('HTMLImportsLoaded', doThis);
    } else {
      doThis();
    }
  }*/

  // maps tag names to prototypes
  var prototypesByName = {};

  function getRegisteredPrototype(name) {
    return prototypesByName[name];
  }

  // elements waiting for prototype, by name
  var waitPrototype = {};

  function notifyPrototype(name) {
    if (waitPrototype[name]) {
      waitPrototype[name].registerWhenReady();
      delete waitPrototype[name];
    }
  }

  /*
  // elements waiting for super, by name
  var waitSuper = {};

  function notifySuper(name) {
    registered[name] = true;
    var waiting = waitSuper[name];
    if (waiting) {
      waiting.forEach(function(w) {
        w.registerWhenReady();
      });
      delete waitSuper[name];
    }
  }
  */
  var importQueue = [];
  var mainQueue = [];

  function queueForElement(element) {
    return document.contains(element) ? mainQueue : importQueue;
  }

  function pushQueue(element) {
    queueForElement(element).push(element);
  }

  function shiftQueue(element) {
    var i = queueIndex(element);
    if (i !== 0) {
      console.warn('queue order wrong', i);
      return;
    }
    queueForElement(element).shift();
  }

  function queueIndex(element) {
    var i = queueForElement(element).indexOf(element);
    if (i >= 0 && document.contains(element)) {
      i += HTMLImports.useNative ? importQueue.length : 1e9;
    }
    return i;
  }

  function nextInQueue() {
    return importQueue.length ? importQueue[0] : mainQueue[0];
  }

  function pokeQueue() {
    // next
    var element = nextInQueue();
    if (element) {
      element.registerWhenReady();
    }
  }

  function isQueueEmpty() {
    return !importQueue.length && !mainQueue.length;
  }

  function waitingForQueue(element) {
    if (queueIndex(element) === -1) {
      pushQueue(element);
    }
    var ready = (queueIndex(element) === 0);
    return !ready;
  }

  function notifyQueue(element) {
    shiftQueue(element);
    pokeQueue();
    notifyElements();
  }


  var canNotifyElements;
  HTMLImports.whenImportsReady(function() {
    pokeQueue();
    canNotifyElements = true;
  });

  // TODO(sorvell): highly experimental replacement for WCR:
  var registerCallback;
  function notifyElements() {
    if (isQueueEmpty() && canNotifyElements) {
      requestAnimationFrame(function() {
        document.dispatchEvent(
          new CustomEvent('PolymerElementsReady', {bubbles: true})
          //new CustomEvent('WebComponentsReady', {bubbles: true})
        );
      });
    }
  }

  // track document.register'ed tag names
  var registered = {};

  function isRegistered(name) {
    return registered[name];
  }

  // exports
  
  scope.getRegisteredPrototype = getRegisteredPrototype;
  
  // namespace shenanigans so we can expose our scope on the registration 
  // function

  // TODO(sjmiles): find a way to do this that is less terrible
  // copy window.Polymer properties onto `element()`
  extend(element, scope);
  // make window.Polymer reference `element()`
  window.Polymer = element;

  // Under the HTMLImports polyfill, scripts in the main document
  // do not block on imports; we want to allow calls to Polymer in the main
  // document. We do so via coordination with Platform:
  var declarations = Platform.deliverDeclarations();
  if (declarations) {
    for (var i=0, l=declarations.length, d; (i<l) && (d=declarations[i]); i++) {
      element.apply(null, d);
    }
  }

  // register polymer-element with document
  document.registerElement('polymer-element', {prototype: prototype});
})(Polymer);
