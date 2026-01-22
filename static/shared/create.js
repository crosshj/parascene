function setupCreateHandler() {
  const createRoute = document.querySelector('app-route-create');
  if (!createRoute) return;

  createRoute.onCreate = async ({ button, server_id, method, args }) => {
    if (!button) return;
    button.disabled = true;

    // Validate required data
    if (!server_id || !method) {
      console.error('Missing required data: server_id and method are required');
      button.disabled = false;
      return;
    }

    const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const pendingItem = {
      id: pendingId,
      status: "creating",
      created_at: new Date().toISOString()
    };
    const pendingKey = "pendingCreations";
    const pendingList = JSON.parse(sessionStorage.getItem(pendingKey) || "[]");
    pendingList.unshift(pendingItem);
    sessionStorage.setItem(pendingKey, JSON.stringify(pendingList));

    document.dispatchEvent(new CustomEvent("creations-pending-updated"));
    const creationsRoute = document.querySelector("app-route-creations");
    if (creationsRoute && typeof creationsRoute.loadCreations === "function") {
      await creationsRoute.loadCreations();
    }

    // Navigate to Creations page immediately (optimistic UI)
    const header = document.querySelector('app-header');
    if (header && typeof header.handleRouteChange === 'function') {
      window.history.pushState({ route: 'creations' }, '', '/creations');
      header.handleRouteChange();
    } else {
      // Fallback: use hash-based routing
      window.location.hash = 'creations';
    }

    fetch("/api/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify({
        server_id,
        method,
        args: args || {}
      })
    })
      .then(async (response) => {
        if (!response.ok) {
          const error = await response.json();
          // Handle insufficient credits error specifically
          if (response.status === 402) {
            // Refresh credits to get updated balance
            document.dispatchEvent(new CustomEvent('credits-updated', {
              detail: { count: error.current ?? 0 }
            }));
            // Trigger credits refresh in create component
            const createRoute = document.querySelector('app-route-create');
            if (createRoute && typeof createRoute.loadCredits === 'function') {
              createRoute.loadCredits();
            }
            throw new Error(error.message || "Insufficient credits");
          }
          throw new Error(error.error || "Failed to create image");
        }
        const data = await response.json();
        // Update credits if returned in response
        if (typeof data.credits_remaining === 'number') {
          document.dispatchEvent(new CustomEvent('credits-updated', {
            detail: { count: data.credits_remaining }
          }));
        }
        return null;
      })
      .then(() => {
        const current = JSON.parse(sessionStorage.getItem(pendingKey) || "[]");
        const next = current.filter(item => item.id !== pendingId);
        sessionStorage.setItem(pendingKey, JSON.stringify(next));
        document.dispatchEvent(new CustomEvent("creations-pending-updated"));
      })
      .catch((error) => {
        const current = JSON.parse(sessionStorage.getItem(pendingKey) || "[]");
        const next = current.filter(item => item.id !== pendingId);
        sessionStorage.setItem(pendingKey, JSON.stringify(next));
        document.dispatchEvent(new CustomEvent("creations-pending-updated"));
        console.error("Error creating image:", error);
        // Refresh credits display in case of error
        const createRoute = document.querySelector('app-route-create');
        if (createRoute && typeof createRoute.loadCredits === 'function') {
          createRoute.loadCredits();
        }
      })
      .finally(() => {
        button.disabled = false;
      });
  };
}

window.setupCreateHandler = setupCreateHandler;
