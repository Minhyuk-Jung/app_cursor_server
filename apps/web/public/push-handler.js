self.addEventListener("push", (event) => {
  let data = { title: "Remote Dev", body: "", deeplink: "/" };
  try {
    data = { ...data, ...event.data?.json() };
  } catch {
    // ignore
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body || data.summary || "",
      data: { url: data.deeplink || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.focus();
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    }),
  );
});
