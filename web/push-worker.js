// No caches, access tokens, private reports or financial details are stored here.
self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    let value;try{value=event.data?.json();}catch{return;}
    if(value?.version!=='flashfirm-push/1'||!/^[a-f0-9-]{36}$/.test(value.workspace)||
      !/^[a-f0-9]{64}$/.test(value.tag))return;
    await self.registration.showNotification('FlashFirm task update',{
      body:'Open your private workspace to review a new task event.',
      icon:'/favicon.svg',tag:value.tag,data:{workspace:value.workspace}
    });
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const id=event.notification.data?.workspace;
  if(!/^[a-f0-9-]{36}$/.test(id??''))return;
  const target=new URL('/?workspace='+encodeURIComponent(id),self.location.origin).href;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const same=windows.find(c=>c.url===target);
    if(same)return same.focus();
    await self.clients.openWindow(target);
  })());
});
