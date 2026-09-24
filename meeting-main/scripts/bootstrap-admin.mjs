// Run locally once, with env populated securely. Never expose this operation through a public route.
import {service,insert,rows,hash,configured} from '../server/platform.js';
if(!configured()||!process.env.INITIAL_ADMIN_EMAIL||!process.env.INITIAL_ADMIN_NAME)throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_ORIGIN, INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_NAME are required.');
if((await rows('meet_profiles','roles=cs.{admin}&active=eq.true')).length)throw new Error('An active administrator already exists. Bootstrap refused.');
const password='Initial!'+await hash(crypto.randomUUID());
const user=await service('/auth/v1/admin/users',{method:'POST',body:{email:process.env.INITIAL_ADMIN_EMAIL,password,email_confirm:true}});
await insert('meet_profiles',{id:user.id,email:process.env.INITIAL_ADMIN_EMAIL,name:process.env.INITIAL_ADMIN_NAME,roles:['admin'],societies:[],must_change_password:true});
console.log('Administrator created without documentary or Advisor rights. Temporary password shown once; replace on first login:');console.log(password);
