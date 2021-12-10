// SPDX-License-Identifier: GPL-3.0
import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/master/contracts/access/Ownable.sol";

pragma solidity ^0.8.10;


contract QuickBridge is Ownable{
    event Send(bytes32 stellarAddress, uint256 value);
    
    function send(bytes32 stellarAddress) public payable {
      emit Send(stellarAddress, msg.value);
    }

    function withdraw() public onlyOwner  {
        payable(owner()).transfer(address(this).balance);
    }
}
