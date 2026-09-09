import {State,Part,PartNumber,Stock,Order,Contact,Attachment,Settings} from '../domain/models';
export interface Services {
 snapshot():State;
 subscribe(listener:()=>void):()=>void;
 catalogue:{search(query:string):Part[];save(part:Part):void;addNumber(number:PartNumber):void;supersede(oldId:string,newId:string):void};
 inventory:{list():Stock[];transfer(partId:string,from:string,to:string,quantity:number,notes:string):void;adjust(partId:string,warehouseId:string,quantity:number,notes:string):void};
 purchasing:{create(order:Order):void;confirm(id:string):void;receive(id:string,quantities:number[]):void;close(id:string):void};
 sales:{create(order:Order):void;confirm(id:string):void;fulfill(id:string):void;invoice(id:string):void;pay(id:string):void;returnItems(id:string,quantities:number[]):void};
 contacts:{save(contact:Contact):void};
 documents:{add(file:Attachment):void;remove(id:string):void};
 management:{saveSettings(settings:Settings):void};
}
